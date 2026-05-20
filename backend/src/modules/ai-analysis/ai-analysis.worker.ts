import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job } from 'bullmq';
import OpenAI from 'openai';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AiAnalysisJob, AI_ANALYSIS_QUEUE } from './ai-analysis.queue';
import { PromptService } from './prompt.service';
import { RuleEvaluationQueue } from '../rules/rule-evaluation.queue';
import { PipelineTrackerService } from '../system/pipeline-tracker.service';
import { UserNotificationsService } from '../user-notifications/user-notifications.service';
import { MetricsService } from '../../shared/metrics/metrics.service';
import { EventsSseService } from '../events/events-sse.service';
import type { Prisma } from '@prisma/client';

const AI_CACHE_PREFIX = 'ai:result:';
const AI_LOCK_PREFIX = 'ai:lock:';
const CLUSTER_LOCK_PREFIX = 'cluster:lock:';
const AI_CACHE_TTL = 86400;
const AI_LOCK_TTL = 120;
const CLUSTER_LOCK_TTL = 120;

interface AiAnalysisResult {
  summary: string;
  rootCause: string;
  stepsToReproduce: string[];
  fixSuggestion: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence?: number;
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
    private readonly ruleEvalQueue: RuleEvaluationQueue,
    private readonly tracker: PipelineTrackerService,
    private readonly notifications: UserNotificationsService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly sse: EventsSseService,
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
    return this.metrics.wrapJob('ai-analysis', async () => {
    const start = Date.now();
    const { projectId, sessionId, errorId, fingerprint, trackingId } = job.data;

    this.logger.log(`AI analysis started for error=${errorId} project=${projectId}`);
    await this.tracker.recordStage(trackingId, 'ai_analysis');

    const error = await this.prisma.error.findUnique({
      where: { id: errorId },
      include: { event: true, session: true },
    });
    if (!error) {
      this.logger.warn(`Error ${errorId} not found — skipping`);
      await this.tracker.recordLatency('ai_analysis', Date.now() - start);
      return;
    }

    // 1. Find or create cluster by fingerprint
    const clusterId = await this.findOrCreateCluster(projectId, errorId, fingerprint);
    if (!clusterId) {
      this.logger.warn(`Could not determine cluster for error=${errorId}`);
      await this.createFailedBug(projectId, sessionId, errorId);
      await this.tracker.recordLatency('ai_analysis', Date.now() - start);
      return;
    }

    // 3. Acquire cluster-level lock to prevent duplicate LLM calls for the same cluster
    const clusterLockKey = `${CLUSTER_LOCK_PREFIX}${clusterId}`;
    const clusterLock = await this.redis.set(clusterLockKey, '1', 'EX', CLUSTER_LOCK_TTL, 'NX');

    if (!clusterLock) {
      // Another worker is handling this cluster — poll for bug creation
      this.logger.debug(`Cluster lock held for cluster=${clusterId} — polling`);
      const bugId = await this.pollForClusterBug(clusterId);
      if (bugId) {
        this.logger.log(`Duplicate cluster error=${errorId} linked to existing bug=${bugId}`);
        await this.checkRegression(projectId, bugId, errorId);
      } else {
        this.logger.error(`Timeout waiting for cluster bug on cluster=${clusterId}`);
      }
      await this.tracker.recordLatency('ai_analysis', Date.now() - start);
      return;
    }

    try {
      // Re-read cluster inside lock to check if another worker already created the bug
      const cluster = await this.prisma.errorCluster.findUnique({ where: { id: clusterId } });
      if (cluster?.bug_id) {
        this.logger.log(`Cluster=${clusterId} already has bug=${cluster.bug_id} — skipping LLM`);
        await this.prisma.error.update({
          where: { id: errorId },
          data: { cluster_id: clusterId },
        });
        await this.checkRegression(projectId, cluster.bug_id, errorId);
        return;
      }

      // 4. Check AI cache by fingerprint (still useful for identical stacks)
      const cacheKey = `${AI_CACHE_PREFIX}${fingerprint}`;
      const cached = await this.redis.get(cacheKey);

      let result: AiAnalysisResult;
      let modelVersion: string;

      if (cached) {
        this.logger.debug(`Cache HIT for fingerprint=${fingerprint}`);
        result = JSON.parse(cached) as AiAnalysisResult;
        modelVersion = 'cached';
      } else {
        // Acquire AI-level lock to prevent duplicate LLM calls for identical fingerprints
        const aiLockKey = `${AI_LOCK_PREFIX}${fingerprint}`;
        const aiLock = await this.redis.set(aiLockKey, '1', 'EX', AI_LOCK_TTL, 'NX');

        if (!aiLock) {
          const polled = await this.pollForCacheResult(cacheKey, fingerprint);
          if (!polled) {
            this.logger.error(`Timeout waiting for AI cache on fingerprint=${fingerprint}`);
            await this.createFailedBug(projectId, sessionId, errorId);
            await this.tracker.recordLatency('ai_analysis', Date.now() - start);
            return;
          }
          result = polled;
          modelVersion = 'cached';
        } else {
          const llmResult = await this.runLlmAnalysis(error, sessionId, projectId, fingerprint);
          if (!llmResult) {
            await this.redis.del(aiLockKey);
            await this.createFailedBug(projectId, sessionId, errorId);
            await this.tracker.recordLatency('ai_analysis', Date.now() - start);
            return;
          }
          result = llmResult;
          modelVersion = llmResult.modelVersion;
          await this.redis.setex(cacheKey, AI_CACHE_TTL, JSON.stringify(result));
          await this.redis.del(aiLockKey);
        }
      }

      // 5. Create bug and link to cluster
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
          status: result.confidence !== undefined && result.confidence < 0.6 ? 'open' : 'open',
          ai_confidence: result.confidence ?? null,
          ai_model_version: modelVersion,
          ai_raw_output: result as unknown as Prisma.JsonObject,
        },
      });

      await this.prisma.errorCluster.update({
        where: { id: clusterId },
        data: { bug_id: bug.id },
      });

      await this.prisma.error.update({
        where: { id: errorId },
        data: { cluster_id: clusterId },
      });

      this.logger.log(`Bug created id=${bug.id} cluster=${clusterId} severity=${result.severity} model=${modelVersion}`);

      // Broadcast new bug event
      const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { tenant_id: true } });
      if (project) {
        this.sse.broadcast(
          { event: 'bug:new', data: { bugId: bug.id, projectId, summary: result.summary ?? 'New bug' } },
          (client) => client.tenantId === project.tenant_id,
        );
      }

      await this.tracker.recordStage(trackingId, 'completed', { bugId: bug.id, errorId });
      await this.tracker.recordLatency('ai_analysis', Date.now() - start);

      // Create in-app notification for a tenant owner/admin
      const tenantOwner = await this.prisma.tenantMember.findFirst({
        where: {
          tenant: { projects: { some: { id: projectId } } },
          role: { in: ['owner', 'admin'] },
        },
        select: { user_id: true },
        orderBy: { role: 'asc' },
      });
      if (tenantOwner) {
        await this.notifications.createNotification({
          userId: tenantOwner.user_id,
          projectId,
          bugId: bug.id,
          type: 'bug_created',
          title: result.summary ?? 'New bug detected',
          body: `Severity: ${result.severity}. ${result.rootCause ?? ''}`,
          severity: result.severity,
        });
      }

      // 6. Trigger rule evaluation only for new bugs
      await this.ruleEvalQueue.add({
        projectId,
        bugId: bug.id,
        errorId,
        clusterId,
        severity: result.severity,
        trackingId,
      });
    } finally {
      await this.redis.del(clusterLockKey);
    }
    });
  }

  private async runLlmAnalysis(
    error: {
      message: string;
      stack: string | null;
      stack_unminified: string | null;
      event: { payload: Prisma.JsonValue; timestamp: bigint } | null;
      session: { user_agent: string | null } | null;
    },
    sessionId: string,
    projectId: string,
    fingerprint: string,
  ): Promise<(AiAnalysisResult & { modelVersion: string }) | null> {
    const recentEvents = await this.prisma.event.findMany({
      where: {
        session_id: sessionId,
        project_id: projectId,
        timestamp: { lte: error.event?.timestamp ?? BigInt(Date.now()) },
      },
      orderBy: { timestamp: 'desc' },
      take: 20,
    });

    const lastApiCall = recentEvents.find((e) => e.type === 'api_response') ?? null;
    const prompt = await this.promptService.getActive();

    const eventsText = recentEvents
      .map((e) => `[${e.type}] ${JSON.stringify(e.payload)}`)
      .join('\n');

    const apiCallText = lastApiCall ? JSON.stringify(lastApiCall.payload) : 'None';
    const eventPayload = error.event?.payload as { url?: string } | null;
    const pageUrl = eventPayload?.url ?? 'Unknown';
    const stackForPrompt = error.stack_unminified ?? error.stack ?? 'No stack trace';

    const userMessage = prompt.userPromptTemplate
      .replace('{{errorMessage}}', error.message)
      .replace('{{stackTrace}}', stackForPrompt)
      .replace('{{recentEvents}}', eventsText || 'No recent events')
      .replace('{{lastApiCall}}', apiCallText)
      .replace('{{pageUrl}}', pageUrl)
      .replace('{{userAgent}}', error.session?.user_agent ?? 'Unknown');

    const { text, model: usedModel } = await this.callWithFallback(prompt.systemPrompt, userMessage);

    if (!text) {
      this.logger.error(`All models exhausted for fingerprint=${fingerprint}`);
      return null;
    }

    const result = this.parseResult(text);
    return { ...result, modelVersion: `${usedModel}@${prompt.version}` };
  }

  private async findOrCreateCluster(
    projectId: string,
    errorId: string,
    fingerprint: string,
  ): Promise<string | null> {
    // Find an existing cluster via any error with the same fingerprint in this project
    const existing = await this.prisma.error.findFirst({
      where: { project_id: projectId, fingerprint, cluster_id: { not: null }, id: { not: errorId } },
      select: { cluster_id: true },
    });

    if (existing?.cluster_id) {
      await this.prisma.errorCluster.update({
        where: { id: existing.cluster_id },
        data: { occurrence_count: { increment: 1 }, last_seen_at: new Date() },
      });
      return existing.cluster_id;
    }

    const result = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO "ErrorCluster" (id, project_id, occurrence_count, last_seen_at, created_at)
      VALUES (gen_random_uuid(), ${projectId}::uuid, 1, NOW(), NOW())
      RETURNING id
    `;
    return result[0]?.id ?? null;
  }

  private async pollForClusterBug(clusterId: string, maxWaitMs = 30000, intervalMs = 500): Promise<string | null> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const cluster = await this.prisma.errorCluster.findUnique({
        where: { id: clusterId },
        select: { bug_id: true },
      });
      if (cluster?.bug_id) return cluster.bug_id;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
  }

  private async pollForCacheResult(cacheKey: string, fingerprint: string, maxWaitMs = 30000, intervalMs = 500): Promise<AiAnalysisResult | null> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        this.logger.debug(`Cache HIT after polling for fingerprint=${fingerprint}`);
        return JSON.parse(cached) as AiAnalysisResult;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
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
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
    };
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

  /**
   * Check if a bug that was previously marked as resolved has reappeared.
   * If so, reopen it, record the release that introduced it, and send a regression notification.
   */
  private async checkRegression(projectId: string, bugId: string, errorId: string) {
    try {
      const bug = await this.prisma.bug.findUnique({
        where: { id: bugId },
        select: { status: true, summary: true, regression_detected_at: true, assigned_to: true },
      });
      if (!bug || bug.status !== 'resolved' || bug.regression_detected_at) {
        return;
      }

      // Fetch the error's release to record which release introduced the regression
      const error = await this.prisma.error.findUnique({
        where: { id: errorId },
        select: { release_id: true },
      });

      await this.prisma.bug.update({
        where: { id: bugId },
        data: {
          status: 'open',
          regression_detected_at: new Date(),
          regression_release_id: error?.release_id ?? null,
        },
      });

      this.logger.warn(`Regression detected: bug=${bugId} was resolved and has reappeared (error=${errorId})`);

      // Notify the bug owner (assignee) if one exists, otherwise notify the project owner
      const notifyUserId = bug.assigned_to;
      if (notifyUserId) {
        await this.notifications.createNotification({
          userId: notifyUserId,
          projectId,
          bugId,
          type: 'regression_detected',
          title: `Regression: ${bug.summary ?? 'Resolved bug'}`,
          body: 'This bug was previously marked as resolved but has reappeared.',
          severity: 'high',
        });
      } else {
        const tenantOwner = await this.prisma.tenantMember.findFirst({
          where: {
            tenant: { projects: { some: { id: projectId } } },
            role: { in: ['owner', 'admin'] },
          },
          select: { user_id: true },
          orderBy: { role: 'asc' },
        });
        if (tenantOwner) {
          await this.notifications.createNotification({
            userId: tenantOwner.user_id,
            projectId,
            bugId,
            type: 'regression_detected',
            title: `Regression: ${bug.summary ?? 'Resolved bug'}`,
            body: 'This bug was previously marked as resolved but has reappeared.',
            severity: 'high',
          });
        }
      }
    } catch (err) {
      this.logger.error(`Regression check failed for bug=${bugId}: ${(err as Error).message}`);
    }
  }
}
