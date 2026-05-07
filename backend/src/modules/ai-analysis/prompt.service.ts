import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

export interface ActivePrompt {
  id: string;
  version: string;
  systemPrompt: string;
  userPromptTemplate: string;
}

@Injectable()
export class PromptService {
  constructor(private readonly prisma: PrismaService) {}

  async getActive(): Promise<ActivePrompt> {
    const prompt = await this.prisma.aiPromptVersion.findFirst({ where: { is_active: true } });

    if (!prompt) {
      return {
        id: 'default',
        version: 'v1-builtin',
        systemPrompt: `You are a senior software engineer analyzing browser errors.
Analyze the error and surrounding events to produce a structured bug report.
Respond ONLY with valid JSON matching the exact schema provided — no markdown, no explanation.`,
        userPromptTemplate: DEFAULT_USER_TEMPLATE,
      };
    }

    return {
      id: prompt.id,
      version: prompt.version,
      systemPrompt: prompt.system_prompt,
      userPromptTemplate: prompt.user_prompt_template,
    };
  }
}

const DEFAULT_USER_TEMPLATE = `Analyze this browser error and produce a bug report.

ERROR:
{{errorMessage}}

STACK TRACE:
{{stackTrace}}

RECENT EVENTS (last 20 before error, newest first):
{{recentEvents}}

LAST API CALL:
{{lastApiCall}}

PAGE URL: {{pageUrl}}
BROWSER: {{userAgent}}

Respond with this exact JSON structure:
{
  "summary": "One sentence describing what went wrong",
  "rootCause": "Technical explanation of the root cause",
  "stepsToReproduce": ["Step 1", "Step 2", "Step 3"],
  "fixSuggestion": "Specific actionable fix recommendation",
  "severity": "low|medium|high|critical"
}`;
