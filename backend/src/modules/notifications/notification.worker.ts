import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { NotificationJob, NOTIFICATION_QUEUE, NotificationQueue } from './notification.queue';
import { NotificationRegistry } from './providers/notification.registry';
import { ProviderError } from '../integrations/providers/provider-error';
import {
  DEFAULT_DISPATCH_RETRY_POLICY,
  computeRetryDelay,
} from '../../shared/retry/retry-policy';
import type { Prisma } from '@prisma/client';
import { MetricsService } from '../../shared/metrics/metrics.service';

const CHANNEL_COOLDOWN_PREFIX = 'channel:cooldown:';
const CHANNEL_FAILURE_COUNT_PREFIX = 'channel:failure_count:';
const COOLDOWN_TTL_SECONDS = 300;

@Injectable()
export class NotificationWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<NotificationJob>;
  private readonly logger = new Logger(NotificationWorker.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly registry: NotificationRegistry,
    private readonly notificationQueue: NotificationQueue,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit() {
    this.worker = new Worker<NotificationJob>(
      NOTIFICATION_QUEUE,
      async (job: Job<NotificationJob>) => this.process(job),
      { connection: this.redis, concurrency: 5 },
    );

    this.worker.on('failed', (job, err) =>
      this.logger.error(`Notification job ${job?.id} failed: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker.close();
  }

  private async process(job: Job<NotificationJob>) {
    return this.metrics.wrapJob('notifications', async () => {
    const { channelId, bugId, logId, attempt } = job.data;

    const [channel, bug] = await Promise.all([
      this.prisma.notificationChannel.findUnique({ where: { id: channelId } }),
      this.prisma.bug.findUnique({
        where: { id: bugId },
        include: { error: true },
      }),
    ]);

    if (!channel || !bug) {
      this.logger.warn(`Channel ${channelId} or bug ${bugId} not found`);
      return;
    }

    // Channel cooldown check
    const cooldownKey = `${CHANNEL_COOLDOWN_PREFIX}${channelId}`;
    const cooldownUntil = await this.redis.get(cooldownKey);
    if (cooldownUntil && Date.now() < parseInt(cooldownUntil, 10)) {
      const waitMs = parseInt(cooldownUntil, 10) - Date.now();
      this.logger.warn(`Channel ${channel.provider_id} (${channelId}) in cooldown — requeuing in ${waitMs}ms`);
      await this.requeue(job.data, waitMs);
      return;
    }

    const provider = this.registry.get(channel.provider_id);

    const payload = {
      bugId: bug.id,
      projectId: bug.project_id,
      summary: bug.summary ?? 'Unknown error',
      rootCause: bug.root_cause ?? 'Unknown',
      severity: bug.severity ?? 'medium',
      errorMessage: bug.error?.message ?? 'Unknown',
      url: `http://localhost:5173/projects/${bug.project_id}/bugs/${bug.id}`,
    };

    // Track first attempt timestamp for retry horizon
    const log = await this.prisma.notificationLog.findUnique({ where: { id: logId } });
    const firstAttemptAt = log?.created_at.getTime() ?? Date.now();

    try {
      const result = await provider.send(payload, channel.config as Record<string, unknown> as Record<string, string | number | boolean | null>);

      await this.prisma.notificationLog.update({
        where: { id: logId },
        data: {
          status: 'sent',
          response: { messageId: result.messageId, attempt } as unknown as Prisma.JsonObject,
        },
      });

      await this.redis.del(`${CHANNEL_FAILURE_COUNT_PREFIX}${channelId}`);
      this.logger.log(`Notification sent to ${provider.name} for bug ${bugId}`);
    } catch (err) {
      const providerErr = err instanceof ProviderError ? err : null;
      const message = (err as Error).message;
      const statusCode = providerErr?.statusCode ?? 0;
      const retryAfterSeconds = providerErr?.retryAfterSeconds;

      this.logger.warn(
        `Notification attempt ${attempt} failed for bug ${bugId} channel ${channelId}: ${message}` +
          (retryAfterSeconds ? ` [Retry-After=${retryAfterSeconds}s]` : ''),
      );

      // Track failures
      await this.redis.incr(`${CHANNEL_FAILURE_COUNT_PREFIX}${channelId}`);
      await this.redis.expire(`${CHANNEL_FAILURE_COUNT_PREFIX}${channelId}`, COOLDOWN_TTL_SECONDS);

      // Set cooldown on rate-limit or server errors
      if (providerErr?.isRateLimit || providerErr?.isServerError) {
        const cooldownMs = retryAfterSeconds
          ? retryAfterSeconds * 1000
          : DEFAULT_DISPATCH_RETRY_POLICY.baseDelayMs * Math.pow(2, attempt);
        const until = Date.now() + Math.min(cooldownMs, DEFAULT_DISPATCH_RETRY_POLICY.maxDelayMs);
        await this.redis.set(cooldownKey, until, 'EX', COOLDOWN_TTL_SECONDS);
      }

      // Compute retry delay
      const delay = computeRetryDelay(attempt, firstAttemptAt, DEFAULT_DISPATCH_RETRY_POLICY, retryAfterSeconds);

      if (delay === null || attempt >= DEFAULT_DISPATCH_RETRY_POLICY.maxAttempts) {
        await this.prisma.notificationLog.update({
          where: { id: logId },
          data: {
            status: 'failed',
            response: { error: message, statusCode, retryAfterSeconds, attempt } as unknown as Prisma.JsonObject,
          },
        });
        this.logger.error(`Notification dead for bug ${bugId} channel ${channelId} after ${attempt} attempts`);
        return;
      }

      await this.prisma.notificationLog.update({
        where: { id: logId },
        data: {
          status: 'retrying',
          response: { error: message, statusCode, attempt, nextRetryAt: new Date(Date.now() + delay).toISOString() } as unknown as Prisma.JsonObject,
        },
      });

      await this.requeue(job.data, delay);
    }
    });
  }

  private async requeue(data: NotificationJob, delayMs: number) {
    this.logger.debug(`Requeuing notification bug=${data.bugId} channel=${data.channelId} delay=${delayMs}ms`);
    await this.notificationQueue.add({ ...data, attempt: data.attempt + 1 }, delayMs);
  }
}
