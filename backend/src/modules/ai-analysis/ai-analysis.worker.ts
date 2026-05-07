import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job } from 'bullmq';
import OpenAI from 'openai';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AiAnalysisJob, AI_ANALYSIS_QUEUE } from './ai-analysis.queue';
import { PromptService } from './prompt.service';
import { ClusteringQueue } from '../clustering/clustering.queue';
import { RuleEvaluationQueue } from '../rules/rule-evaluation.queue';
import type { Prisma } from '@prisma/client';

const AI_CACHE_PREFIX = 'ai:result:';
const AI_CACHE_TTL = 86400;

interface AiAnalysisResult {
  summary: string;
  rootCause: string;
  stepsToReproduce: string[];
  fixSuggestion: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

@Injectable()
export class AiAnalysisWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<AiAnalysisJob>;
  private readonly logger = new Logger(AiAnalysisWorker.name);
  private readonly ai: OpenAI;
  private readonly models: string[];

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly promptService: PromptService,
    private readonly clusteringQueue: ClusteringQueue,
    private readonly ruleEvalQueue: RuleEvaluationQueue,
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

    // AI_MODELS = comma-separated fallback chain; AI_MODEL = single model (legacy)
    const modelsEnv = this.config.get<string>('AI_MODELS') ?? this.config.get<string>('AI_MODEL') ?? 'gpt-4o-mini';
    this.models = modelsEnv.split(',').map((m) => m.trim()).filter(Boolean);
  }

  onModuleInit() {
    this.worker = new Worker<AiAnalysisJob>(
      AI_ANALYSIS_QUEUE,
      async (job: Job<AiAnalysisJob>) => this.process(job),
      { connection: this.redis, concurrency: 2 },
    );

    this.worker.on('failed', (job, err) =>
      this.logger.error(`AI analysis job ${job?.id} failed: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker.close();
  }

  private async process(job: Job<AiAnalysisJob>) {
    const { projectId, sessionId, errorId, fingerprint } = job.data;

    this.logger.log(`AI analysis started for error=${errorId} project=${projectId}`);

    const error = await this.prisma.error.findUnique({
      where: { id: errorId },
      include: { event: true, session: true },
    });
    if (!error) {
      this.logger.warn(`Error ${errorId} not found — skipping`);
      return;
    }

    const recentEvents = await this.prisma.event.findMany({
      where: {
        session_id: sessionId,
        project_id: projectId,
        timestamp: { lte: error.event.timestamp },
      },
      orderBy: { timestamp: 'desc' },
      take: 20,
    });

    const lastApiCall = recentEvents.find((e) => e.type === 'api_response') ?? null;

    const cacheKey = `${AI_CACHE_PREFIX}${fingerprint}`;
    const cached = await this.redis.get(cacheKey);

    let result: AiAnalysisResult;
    let modelVersion: string;

    if (cached) {
      this.logger.debug(`Cache HIT for fingerprint=${fingerprint}`);
      result = JSON.parse(cached) as AiAnalysisResult;
      modelVersion = 'cached';
    } else {
      const prompt = await this.promptService.getActive();

      const eventsText = recentEvents
        .map((e) => `[${e.type}] ${JSON.stringify(e.payload)}`)
        .join('\n');

      const apiCallText = lastApiCall ? JSON.stringify(lastApiCall.payload) : 'None';
      const eventPayload = error.event.payload as { url?: string } | null;
      const pageUrl = eventPayload?.url ?? 'Unknown';

      const userMessage = prompt.userPromptTemplate
        .replace('{{errorMessage}}', error.message)
        .replace('{{stackTrace}}', error.stack ?? 'No stack trace')
        .replace('{{recentEvents}}', eventsText || 'No recent events')
        .replace('{{lastApiCall}}', apiCallText)
        .replace('{{pageUrl}}', pageUrl)
        .replace('{{userAgent}}', error.session.user_agent ?? 'Unknown');

      const { text, model: usedModel } = await this.callWithFallback(prompt.systemPrompt, userMessage);

      if (!text) {
        this.logger.error(`All models exhausted for error=${errorId}`);
        await this.createFailedBug(projectId, sessionId, errorId);
        return;
      }

      result = this.parseResult(text);
      modelVersion = `${usedModel}@${prompt.version}`;

      await this.redis.setex(cacheKey, AI_CACHE_TTL, JSON.stringify(result));
      this.logger.debug(`Cache SET for fingerprint=${fingerprint} via model=${usedModel}`);
    }

    const embedding = await this.generateEmbedding(`${error.message} ${error.stack ?? ''}`);

    const bug = await this.prisma.bug.create({
      data: {
        project_id: projectId,
        session_id: sessionId,
        error_id: errorId,
        summary: result.summary,
        root_cause: result.rootCause,
        steps_to_reproduce: result.stepsToReproduce as unknown as Prisma.JsonArray,
        fix_suggestion: result.fixSuggestion,
        severity: result.severity,
        status: 'open',
        ai_model_version: modelVersion,
        ai_raw_output: result as unknown as Prisma.JsonObject,
      },
    });

    if (embedding.length > 0) {
      await this.prisma.$executeRaw`
        UPDATE "Error" SET vector = ${JSON.stringify(embedding)}::vector
        WHERE id = ${errorId}::uuid
      `;
    }

    await Promise.all([
      embedding.length > 0
        ? this.clusteringQueue.add({ projectId, errorId, vector: embedding })
        : Promise.resolve(),
      this.ruleEvalQueue.add({
        projectId,
        bugId: bug.id,
        errorId,
        clusterId: '',
        severity: result.severity,
      }),
    ]);

    this.logger.log(`Bug created id=${bug.id} severity=${result.severity} model=${modelVersion}`);
  }

  private async callWithFallback(
    systemPrompt: string,
    userMessage: string,
  ): Promise<{ text: string; model: string } | { text: null; model: null }> {
    for (const model of this.models) {
      try {
        const response = await this.ai.chat.completions.create({
          model,
          max_tokens: 1024,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        });
        const text = response.choices[0]?.message.content ?? '';
        this.logger.debug(`Model ${model} succeeded`);
        return { text, model };
      } catch (err) {
        const e = err as Error & { status?: number; error?: unknown };
        this.logger.warn(`Model ${model} failed [${e.status ?? '?'}]: ${e.message} | ${JSON.stringify(e.error ?? '')} — trying next`);
      }
    }
    return { text: null, model: null };
  }

  private parseResult(text: string): AiAnalysisResult {
    const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    const parsed = JSON.parse(cleaned) as Partial<AiAnalysisResult>;

    const severities = ['low', 'medium', 'high', 'critical'] as const;
    const severity = severities.includes(parsed.severity as (typeof severities)[number])
      ? (parsed.severity as AiAnalysisResult['severity'])
      : 'medium';

    return {
      summary: parsed.summary ?? 'An error occurred',
      rootCause: parsed.rootCause ?? 'Unknown root cause',
      stepsToReproduce: Array.isArray(parsed.stepsToReproduce) ? parsed.stepsToReproduce : [],
      fixSuggestion: parsed.fixSuggestion ?? 'Investigate the error and stack trace',
      severity,
    };
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    const embeddingModel = this.config.get<string>('AI_EMBEDDING_MODEL');
    if (!embeddingModel) return [];
    try {
      const response = await this.ai.embeddings.create({
        model: embeddingModel,
        input: text.slice(0, 2048),
      });
      return response.data[0]?.embedding ?? [];
    } catch {
      return [];
    }
  }

  private async createFailedBug(projectId: string, sessionId: string, errorId: string) {
    try {
      await this.prisma.bug.upsert({
        where: { error_id: errorId },
        create: {
          project_id: projectId,
          session_id: sessionId,
          error_id: errorId,
          summary: 'AI analysis failed',
          root_cause: 'LLM unavailable',
          steps_to_reproduce: [] as unknown as Prisma.JsonArray,
          fix_suggestion: 'Review error manually',
          severity: 'medium',
          status: 'ai_failed',
          ai_model_version: 'failed',
        },
        update: {},
      });
    } catch (err) {
      this.logger.error(`Failed to create fallback bug: ${(err as Error).message}`);
    }
  }
}
