import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import OpenAI from 'openai';
import { PrismaService } from '../../shared/prisma/prisma.service';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

export interface ChatThread {
  id: string;
  bugId: string;
  messages: ChatMessage[];
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly ai: OpenAI;
  private readonly models: string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.ai = new OpenAI({
      apiKey: this.config.get<string>('AI_API_KEY') ?? '',
      baseURL: this.config.get<string>('AI_BASE_URL'),
      defaultHeaders: {
        'HTTP-Referer': 'https://bug-intelligence.local',
        'X-Title': 'Bug Intelligence',
      },
    });

    const modelsEnv = this.config.get<string>('AI_MODELS') ?? this.config.get<string>('AI_MODEL') ?? 'gpt-4o-mini';
    this.models = modelsEnv.split(',').map((m) => m.trim()).filter(Boolean);
  }

  async getOrCreateThread(projectId: string, bugId: string): Promise<ChatThread> {
    let thread = await this.prisma.chatThread.findUnique({
      where: { bug_id: bugId },
      include: { messages: { orderBy: { created_at: 'asc' } } },
    });

    if (!thread) {
      try {
        thread = await this.prisma.chatThread.create({
          data: {
            bug_id: bugId,
            project_id: projectId,
          },
          include: { messages: { orderBy: { created_at: 'asc' } } },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          // Race condition: another request created the thread
          thread = await this.prisma.chatThread.findUnique({
            where: { bug_id: bugId },
            include: { messages: { orderBy: { created_at: 'asc' } } },
          });
        } else {
          throw error;
        }
      }
    }

    if (!thread) {
      throw new Error('Failed to get or create chat thread');
    }

    return {
      id: thread.id,
      bugId: thread.bug_id,
      messages: thread.messages.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        createdAt: m.created_at,
      })),
    };
  }

  async sendMessage(projectId: string, bugId: string, userMessage: string): Promise<ChatMessage> {
    const thread = await this.getOrCreateThread(projectId, bugId);

    // Fetch bug context
    const bug = await this.prisma.bug.findFirst({
      where: { id: bugId, project_id: projectId },
      include: {
        error: {
          include: { event: true, session: true },
        },
        session: true,
      },
    });

    if (!bug) {
      throw new Error('Bug not found');
    }

    // Fetch recent events for context
    const recentEvents = bug.session
      ? await this.prisma.event.findMany({
          where: {
            session_id: bug.session.id,
            project_id: projectId,
          },
          orderBy: { timestamp: 'desc' },
          take: 10,
        })
      : [];

    const systemPrompt = this.buildSystemPrompt(bug, recentEvents);

    // Build message history for the LLM
    const history = thread.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // Save user message
    await this.prisma.chatMessage.create({
      data: {
        thread_id: thread.id,
        role: 'user',
        content: userMessage,
      },
    });

    // Call LLM
    const assistantContent = await this.callLlm(systemPrompt, [...history, { role: 'user' as const, content: userMessage }]);

    // Save assistant message
    const assistantMessage = await this.prisma.chatMessage.create({
      data: {
        thread_id: thread.id,
        role: 'assistant',
        content: assistantContent,
      },
    });

    return {
      id: assistantMessage.id,
      role: 'assistant',
      content: assistantContent,
      createdAt: assistantMessage.created_at,
    };
  }

  private buildSystemPrompt(
    bug: {
      summary: string | null;
      root_cause: string | null;
      fix_suggestion: string | null;
      steps_to_reproduce: unknown;
      severity: string | null;
      error: {
        message: string;
        stack: string | null;
        stack_unminified: string | null;
        event: { payload: unknown; url?: string } | null;
      };
    },
    recentEvents: Array<{ type: string; payload: unknown }>,
  ): string {
    const stack = bug.error.stack_unminified ?? bug.error.stack ?? 'No stack trace';
    const steps = Array.isArray(bug.steps_to_reproduce)
      ? bug.steps_to_reproduce.map((s, i) => `${i + 1}. ${s}`).join('\n')
      : 'No steps recorded';

    const eventsText = recentEvents
      .map((e) => `[${e.type}] ${JSON.stringify(e.payload).slice(0, 200)}`)
      .join('\n');

    return `You are an expert debugging assistant embedded in a bug tracking platform. You have access to the full context of a bug report and help the developer understand, investigate, and fix it.

## Bug Context

**Summary:** ${bug.summary ?? 'N/A'}
**Severity:** ${bug.severity ?? 'unknown'}
**Root Cause (AI-analyzed):** ${bug.root_cause ?? 'N/A'}
**Fix Suggestion:** ${bug.fix_suggestion ?? 'N/A'}

**Steps to Reproduce:**
${steps}

**Error Message:**
${bug.error.message}

**Stack Trace:**
\`\`\`
${stack}
\`\`\`

**Recent Events:**
${eventsText || 'No recent events'}

## Instructions

- Be concise and actionable. Prefer specific file names, function names, and line numbers when referencing the stack trace.
- If the user asks about the root cause, explain it in plain terms and relate it to the stack trace.
- If the user asks how to fix it, give step-by-step instructions with code examples where helpful.
- If the user asks about impact, estimate severity based on the error type and stack trace.
- If you don't have enough information, say so clearly and suggest what data would help.
- Do not make up information that isn't in the context. If the context is insufficient, say "I don't have enough context to answer that."`;
  }

  private async callLlm(systemPrompt: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<string> {
    for (const model of this.models) {
      try {
        const response = await this.ai.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          ],
          temperature: 0.3,
          max_tokens: 2048,
        });

        const content = response.choices[0]?.message?.content ?? '';
        if (content) {
          return content;
        }
      } catch (err) {
        const msg = (err as Error).message;
        this.logger.warn(`Chat LLM call failed for model ${model}: ${msg}`);
        // Try next model
      }
    }

    return 'I apologize, but I am unable to process your request at the moment. Please try again later.';
  }
}
