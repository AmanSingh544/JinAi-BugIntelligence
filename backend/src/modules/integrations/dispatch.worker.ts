import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { DispatchJob, DispatchQueue, DISPATCH_QUEUE } from './dispatch.queue';
import { IntegrationRegistry } from './providers/integration.registry';
import type {
  BugReportPayload,
  JsonValue,
} from './providers/integration.interface';
import { ProviderError } from './providers/provider-error';
import { PipelineTrackerService } from '../system/pipeline-tracker.service';
import {
  DEFAULT_DISPATCH_RETRY_POLICY,
  computeRetryDelay,
} from '../../shared/retry/retry-policy';
import type { Prisma } from '@prisma/client';
import { acquireLock } from '../../shared/redis/acquire-lock';
import { releaseLock } from '../../shared/redis/release-lock';
import { MetricsService } from '../../shared/metrics/metrics.service';

const PROVIDER_COOLDOWN_PREFIX = 'provider:cooldown:';
const PROVIDER_FAILURE_COUNT_PREFIX = 'provider:failure_count:';
const COOLDOWN_TTL_SECONDS = 300; // 5 minutes

const LOCK_PREFIX = `${process.env.NODE_ENV ?? 'development'}:queue:dispatch:lock:`;
const LOCK_TTL_SECONDS = 180;

function buildDispatchLockKey(dispatchKey: string): string {
  return `${LOCK_PREFIX}${dispatchKey}`;
}

function buildLockValue(jobId: string): string {
  return `${jobId}:${Date.now()}`;
}

@Injectable()
export class DispatchWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<DispatchJob>;
  private readonly logger = new Logger(DispatchWorker.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly registry: IntegrationRegistry,
    private readonly dispatchQueue: DispatchQueue,
    private readonly tracker: PipelineTrackerService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit() {
    this.worker = new Worker<DispatchJob>(
      DISPATCH_QUEUE,
      async (job: Job<DispatchJob>) => this.process(job),
      { connection: this.redis, concurrency: 3 },
    );

    this.worker.on('failed', (job, err) =>
      this.logger.error(`Dispatch job ${job?.id} failed: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker.close();
  }

  private async process(job: Job<DispatchJob>) {
    return this.metrics.wrapJob('dispatch', async () => {
      const start = Date.now();
      const { bugId, integrationId, attempt, trackingId } = job.data;

      await this.tracker.recordStage(trackingId, 'dispatch');

      const [bug, integration] = await Promise.all([
        this.prisma.bug.findUnique({
          where: { id: bugId },
          include: { error: { include: { event: true } }, session: true },
        }),
        this.prisma.projectIntegration.findUnique({
          where: { id: integrationId },
        }),
      ]);

      if (!bug || !integration) {
        this.logger.warn(
          `Bug ${bugId} or integration ${integrationId} not found`,
        );
        return;
      }

      const payload = this.buildPayload(bug);
      const provider = this.registry.get(integration.provider_id);

      const dispatchKey = `${bugId}:${integrationId}`;
      const lockKey = buildDispatchLockKey(dispatchKey);
      const lockValue = buildLockValue(String(job.id));

      let acquired = false;
      try {
        acquired = await acquireLock(
          this.redis,
          lockKey,
          lockValue,
          LOCK_TTL_SECONDS,
        );
        if (!acquired) {
          this.logger.debug(
            `Dispatch lock already held for ${dispatchKey}, skipping`,
          );
          return;
        }
      } catch (redisErr) {
        this.logger.error(
          `Redis error acquiring dispatch lock for ${dispatchKey}: ${(redisErr as Error).message}`,
        );
        throw redisErr; // Let BullMQ retry the job
      }

      try {
        // Idempotency check (fast path — still racy without the lock, but cheap)
        const existingSuccess = await this.prisma.integrationDelivery.findFirst(
          {
            where: { dispatch_key: dispatchKey, status: 'success' },
          },
        );
        if (existingSuccess) {
          this.logger.log(
            `Dispatch already succeeded for bug ${bugId} → ${integrationId}, skipping`,
          );
          return;
        }

        // Provider cooldown check
        const cooldownKey = `${PROVIDER_COOLDOWN_PREFIX}${integrationId}`;
        const cooldownUntil = await this.redis.get(cooldownKey);
        if (cooldownUntil && Date.now() < parseInt(cooldownUntil, 10)) {
          const waitMs = parseInt(cooldownUntil, 10) - Date.now();
          this.logger.warn(
            `Provider ${provider.id} (integration=${integrationId}) in cooldown — requeuing in ${waitMs}ms`,
          );
          await this.requeue(job.data, waitMs, 'provider_cooldown');
          return;
        }

        let delivery = await this.prisma.integrationDelivery.findFirst({
          where: { bug_id: bugId, integration_id: integrationId },
        });

        if (!delivery) {
          delivery = await this.prisma.integrationDelivery.create({
            data: {
              bug_id: bugId,
              integration_id: integrationId,
              dispatch_key: dispatchKey,
              status: 'retrying',
              attempts: 0,
            },
          });
        }

        // Track first attempt timestamp for retry horizon
        const firstAttemptAt = delivery.created_at.getTime();

        try {
          const result = await provider.createTicket(
            payload,
            integration.config as Record<string, JsonValue>,
          );

          try {
            await this.prisma.$transaction([
              this.prisma.integrationDelivery.update({
                where: { id: delivery.id },
                data: {
                  status: 'success',
                  remote_ticket_id: result.ticketId,
                  remote_ticket_url: result.url,
                  attempts: attempt,
                  response: result as unknown as Prisma.JsonObject,
                },
              }),
            ]);
          } catch (dbErr) {
            // Partial unique index violation = another worker already succeeded
            const msg = (dbErr as Error).message ?? '';
            if (
              msg.includes('integration_delivery_unique_success_idx') ||
              msg.includes('Unique constraint')
            ) {
              this.logger.log(
                `Duplicate success prevented by DB guardrail for bug ${bugId} → ${integrationId} — treating as already dispatched`,
              );
              return;
            }
            throw dbErr;
          }

          // Clear failure counter on success
          await this.redis.del(
            `${PROVIDER_FAILURE_COUNT_PREFIX}${integrationId}`,
          );

          this.logger.log(
            `Dispatched bug ${bugId} → ${provider.name} ticket ${result.ticketId}`,
          );
          await this.tracker.recordLatency('dispatch', Date.now() - start);
        } catch (err) {
          const providerErr = err instanceof ProviderError ? err : null;
          const message = (err as Error).message;
          const statusCode = providerErr?.statusCode ?? 0;
          const retryAfterSeconds = providerErr?.retryAfterSeconds;

          this.logger.warn(
            `Dispatch attempt ${attempt} failed for bug ${bugId}: ${message}` +
              (retryAfterSeconds ? ` [Retry-After=${retryAfterSeconds}s]` : ''),
          );

          // Track provider failures for observability
          await this.redis.incr(
            `${PROVIDER_FAILURE_COUNT_PREFIX}${integrationId}`,
          );
          await this.redis.expire(
            `${PROVIDER_FAILURE_COUNT_PREFIX}${integrationId}`,
            COOLDOWN_TTL_SECONDS,
          );

          // Set cooldown on rate-limit or server errors
          if (providerErr?.isRateLimit || providerErr?.isServerError) {
            const cooldownMs = retryAfterSeconds
              ? retryAfterSeconds * 1000
              : DEFAULT_DISPATCH_RETRY_POLICY.baseDelayMs *
                Math.pow(2, attempt);
            const cooldownUntil =
              Date.now() +
              Math.min(cooldownMs, DEFAULT_DISPATCH_RETRY_POLICY.maxDelayMs);
            await this.redis.set(
              cooldownKey,
              cooldownUntil,
              'EX',
              COOLDOWN_TTL_SECONDS,
            );
            this.logger.warn(
              `Provider ${provider.id} cooldown set until ${new Date(cooldownUntil).toISOString()}`,
            );
          }

          // Permanent failures (bad credentials, missing repo/project, invalid
          // payload) can never succeed on retry — fail fast to the DLQ instead
          // of burning the 0s/30s/5m/30m/2h ladder.
          if (providerErr?.isPermanent) {
            await this.prisma.integrationDelivery.update({
              where: { id: delivery.id },
              data: {
                status: 'dead',
                attempts: attempt,
                response: {
                  error: message,
                  statusCode,
                  permanent: true,
                },
              },
            });
            await this.dispatchQueue.addToDlq({
              bugId,
              integrationId,
              attempt,
            });
            this.logger.error(
              `Bug ${bugId} dispatch dead: permanent provider error (status=${statusCode}) — not retrying. ${message}`,
            );
            await this.tracker.recordLatency('dispatch', Date.now() - start);
            return;
          }

          // Compute retry delay with exponential backoff + jitter + Retry-After + max horizon
          const delay = computeRetryDelay(
            attempt,
            firstAttemptAt,
            DEFAULT_DISPATCH_RETRY_POLICY,
            retryAfterSeconds,
          );

          if (
            delay === null ||
            attempt >= DEFAULT_DISPATCH_RETRY_POLICY.maxAttempts
          ) {
            await this.prisma.integrationDelivery.update({
              where: { id: delivery.id },
              data: {
                status: 'dead',
                attempts: attempt,
                response: {
                  error: message,
                  statusCode,
                  retryAfterSeconds,
                },
              },
            });
            await this.dispatchQueue.addToDlq({
              bugId,
              integrationId,
              attempt,
            });
            this.logger.error(
              `Bug ${bugId} dispatch dead after ${attempt} attempts (horizon=${delay === null ? 'exceeded' : 'max attempts'})`,
            );
            await this.tracker.recordLatency('dispatch', Date.now() - start);
            return;
          }

          await this.prisma.integrationDelivery.update({
            where: { id: delivery.id },
            data: {
              status: 'retrying',
              attempts: attempt,
              next_retry_at: new Date(Date.now() + delay),
            },
          });

          await this.requeue(job.data, delay, 'retry');
          await this.tracker.recordLatency('dispatch', Date.now() - start);
        }
      } finally {
        if (acquired) {
          try {
            await releaseLock(this.redis, lockKey, lockValue);
          } catch (releaseErr) {
            // Unlock failure after successful persistence is operationally important
            // but must NOT fail the job — the ticket was already created
            this.logger.warn(
              `Failed to release dispatch lock ${lockKey} after dispatch: ${(releaseErr as Error).message}`,
            );
          }
        }
      }
    });
  }

  private async requeue(data: DispatchJob, delayMs: number, reason: string) {
    this.logger.debug(
      `Requeuing dispatch bug=${data.bugId} integration=${data.integrationId} delay=${delayMs}ms reason=${reason}`,
    );
    await this.dispatchQueue.add(
      { ...data, attempt: data.attempt + 1 },
      delayMs,
    );
  }

  private buildPayload(bug: {
    id: string;
    project_id: string;
    session_id: string | null;
    summary: string | null;
    root_cause: string | null;
    steps_to_reproduce: Prisma.JsonValue;
    fix_suggestion: string | null;
    severity: string | null;
    created_at: Date;
    error: {
      message: string;
      stack: string | null;
      event: { url?: string; payload: Prisma.JsonValue } | null;
    };
    session: { user_agent: string | null } | null;
  }): BugReportPayload {
    const steps = Array.isArray(bug.steps_to_reproduce)
      ? (bug.steps_to_reproduce as string[])
      : [];

    const eventPayload = bug.error.event?.payload as { url?: string } | null;

    return {
      bugId: bug.id,
      projectId: bug.project_id,
      summary: bug.summary ?? 'Unknown error',
      rootCause: bug.root_cause ?? 'Unknown',
      stepsToReproduce: steps,
      fixSuggestion: bug.fix_suggestion ?? 'Investigate the error',
      severity: (bug.severity ?? 'medium') as BugReportPayload['severity'],
      errorMessage: bug.error.message,
      stackTrace: bug.error.stack ?? undefined,
      sessionUrl: bug.session_id
        ? `${process.env.DASHBOARD_URL ?? 'http://localhost:5173'}/sessions/${bug.session_id}`
        : 'Unknown',
      affectedUrl: eventPayload?.url ?? 'Unknown',
      browser: bug.session?.user_agent ?? 'Unknown',
      timestamp: bug.created_at.toISOString(),
      sessionId: bug.session_id,
    };
  }
}
