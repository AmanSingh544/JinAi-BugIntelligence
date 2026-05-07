import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AiAnalysisQueue } from '../ai-analysis/ai-analysis.queue';
import { ErrorDetectionJob, ERROR_DETECTION_QUEUE } from './error-detection.queue';
import { normalizeStack } from './normalize-stack';

@Injectable()
export class ErrorDetectionWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<ErrorDetectionJob>;
  private readonly logger = new Logger(ErrorDetectionWorker.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly aiQueue: AiAnalysisQueue,
  ) {}

  onModuleInit() {
    this.worker = new Worker<ErrorDetectionJob>(
      ERROR_DETECTION_QUEUE,
      async (job: Job<ErrorDetectionJob>) => this.process(job),
      { connection: this.redis, concurrency: 3 },
    );

    this.worker.on('failed', (job, err) =>
      this.logger.error(`Error detection job ${job?.id} failed: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker.close();
  }

  private async process(job: Job<ErrorDetectionJob>) {
    const { projectId, sessionId, eventId, errorPayload } = job.data;

    this.logger.log(`Error detection: message="${errorPayload.message}" project=${projectId} session=${sessionId}`);

    const normalized = normalizeStack(errorPayload.stack);
    const fingerprint = createHash('sha256')
      .update(errorPayload.message + normalized)
      .digest('hex');

    // Dedup bucket = current hour (truncated) — prevents race conditions via DB unique constraint
    const now = new Date();
    const dedupBucket = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()),
    );

    // Idempotent upsert — ON CONFLICT DO NOTHING via skipDuplicates
    // Unique constraint: (fingerprint, project_id, dedup_bucket) in schema
    try {
      const created = await this.prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO "Error" (id, session_id, project_id, event_id, message, stack, fingerprint, dedup_bucket, created_at)
        VALUES (
          gen_random_uuid(),
          ${sessionId}::uuid,
          ${projectId}::uuid,
          ${eventId}::uuid,
          ${errorPayload.message},
          ${errorPayload.stack ?? null},
          ${fingerprint},
          ${dedupBucket},
          NOW()
        )
        ON CONFLICT (fingerprint, project_id, dedup_bucket) DO NOTHING
        RETURNING id
      `;

      if (!created.length) {
        this.logger.debug(`Deduped error fingerprint=${fingerprint} for project=${projectId}`);
        return;
      }

      const errorId = created[0].id;

      // Queue for AI analysis — only IDs + fingerprint, not the full payload
      await this.aiQueue.add({ projectId, sessionId, errorId, fingerprint });

      this.logger.debug(`New error detected id=${errorId} fingerprint=${fingerprint}`);
    } catch (err) {
      this.logger.error(`Error detection failed: ${(err as Error).message}`);
      throw err;
    }
  }
}
