import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AiAnalysisQueue } from '../ai-analysis/ai-analysis.queue';
import { EmbeddingQueue } from '../ai-analysis/embedding.queue';
import { PipelineTrackerService } from '../system/pipeline-tracker.service';
import {
  ErrorDetectionJob,
  ERROR_DETECTION_QUEUE,
} from './error-detection.queue';
import { MetricsService } from '../../shared/metrics/metrics.service';
import { fingerprintNormalizeStack } from './normalize-stack';
import { unminifyStack, type SourcemapRecord } from './stack-unminifier';

@Injectable()
export class ErrorDetectionWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<ErrorDetectionJob>;
  private readonly logger = new Logger(ErrorDetectionWorker.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly aiQueue: AiAnalysisQueue,
    private readonly embeddingQueue: EmbeddingQueue,
    private readonly tracker: PipelineTrackerService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit() {
    this.worker = new Worker<ErrorDetectionJob>(
      ERROR_DETECTION_QUEUE,
      async (job: Job<ErrorDetectionJob>) => this.process(job),
      { connection: this.redis, concurrency: 3 },
    );

    this.worker.on('failed', (job, err) =>
      this.logger.error(
        `Error detection job ${job?.id} failed: ${err.message}`,
      ),
    );
  }

  async onModuleDestroy() {
    await this.worker.close();
  }

  private async process(job: Job<ErrorDetectionJob>) {
    return this.metrics.wrapJob('error-detection', async () => {
      const start = Date.now();
      const {
        projectId,
        sessionId,
        eventId,
        errorPayload,
        releaseId,
        trackingId,
      } = job.data;

      await this.tracker.recordStage(trackingId, 'detection');

      this.logger.log(
        `Error detection: message="${errorPayload.message}" project=${projectId} session=${sessionId}`,
      );

      // Try to unminify stack using all sourcemaps for this release
      let stackUnminified: string | null = null;
      if (releaseId && errorPayload.stack) {
        const sourcemapRecords = await this.prisma.releaseSourcemap.findMany({
          where: { release_id: releaseId, sourcemap_parsed: true },
        });

        if (sourcemapRecords.length > 0) {
          const sourcemaps = new Map<string, SourcemapRecord>(
            sourcemapRecords.map((s) => [
              s.minified_filename,
              {
                sourcemap_path: s.sourcemap_path,
                declared_file: s.declared_file,
                sourcemap_parsed: s.sourcemap_parsed,
              },
            ]),
          );
          stackUnminified = await unminifyStack(errorPayload.stack, sourcemaps);
          if (stackUnminified) {
            this.logger.debug(`Unminified stack for release ${releaseId}`);
          }
        } else {
          // Fallback: check legacy single-sourcemap field (migration-only)
          const release = await this.prisma.release.findUnique({
            where: { id: releaseId },
          });
          if (release?.sourcemap && release.sourcemap_parsed) {
            const legacyMap = new Map<string, SourcemapRecord>([
              [
                'unknown',
                {
                  sourcemap_path: release.sourcemap,
                  declared_file: null,
                  sourcemap_parsed: release.sourcemap_parsed,
                },
              ],
            ]);
            stackUnminified = await unminifyStack(
              errorPayload.stack,
              legacyMap,
            );
            if (stackUnminified) {
              this.logger.debug(
                `Unminified stack using legacy sourcemap for release ${releaseId}`,
              );
            }
          }
        }
      }

      const fingerprintNormalized = fingerprintNormalizeStack(
        stackUnminified ?? errorPayload.stack,
      );
      const fingerprint = createHash('sha256')
        .update(errorPayload.message + fingerprintNormalized)
        .digest('hex');

      // Dedup bucket = current hour (truncated) — prevents race conditions via DB unique constraint
      const now = new Date();
      const dedupBucket = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          now.getUTCHours(),
        ),
      );

      // Idempotent upsert — ON CONFLICT DO NOTHING via skipDuplicates
      // Unique constraint: (fingerprint, project_id, dedup_bucket) in schema
      try {
        const created = await this.prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO "Error" (id, session_id, project_id, event_id, release_id, message, stack, stack_unminified, fingerprint, dedup_bucket, created_at)
        VALUES (
          gen_random_uuid(),
          ${sessionId}::uuid,
          ${projectId}::uuid,
          ${eventId}::uuid,
          ${releaseId ?? null}::uuid,
          ${errorPayload.message},
          ${errorPayload.stack ?? null},
          ${stackUnminified ?? null},
          ${fingerprint},
          ${dedupBucket},
          NOW()
        )
        ON CONFLICT (fingerprint, project_id, dedup_bucket) DO NOTHING
        RETURNING id
      `;

        if (!created.length) {
          // Duplicate within this dedup bucket — no new row, but keep counts honest
          // so cluster.occurrences rules and dashboards reflect real volume.
          this.metrics.fingerprintEventsTotal.inc({ result: 'deduped' });
          const dup = await this.prisma.$queryRaw<
            { cluster_id: string | null }[]
          >`
          UPDATE "Error" SET occurrence_count = occurrence_count + 1
          WHERE fingerprint = ${fingerprint}
            AND project_id = ${projectId}::uuid
            AND dedup_bucket = ${dedupBucket}
          RETURNING cluster_id
        `;
          const dupClusterId = dup[0]?.cluster_id;
          if (dupClusterId) {
            await this.prisma.errorCluster.update({
              where: { id: dupClusterId },
              data: {
                occurrence_count: { increment: 1 },
                last_seen_at: new Date(),
              },
            });
          }
          this.logger.debug(
            `Deduped error fingerprint=${fingerprint} for project=${projectId}`,
          );
          await this.tracker.recordLatency('detection', Date.now() - start);
          return;
        }

        this.metrics.fingerprintEventsTotal.inc({ result: 'new' });

        const errorId = created[0].id;

        // Queue for AI analysis — only IDs + fingerprint, not the full payload
        await this.aiQueue.add({
          projectId,
          sessionId,
          errorId,
          fingerprint,
          trackingId,
        });

        // Queue for async embedding generation — decouples embedding API from analysis
        const embeddingText = `${errorPayload.message} ${stackUnminified ?? errorPayload.stack ?? ''}`;
        await this.embeddingQueue.add({ errorId, text: embeddingText });

        this.logger.debug(
          `New error detected id=${errorId} fingerprint=${fingerprint}`,
        );
        await this.tracker.recordLatency('detection', Date.now() - start);
      } catch (err) {
        this.logger.error(`Error detection failed: ${(err as Error).message}`);
        throw err;
      }
    });
  }
}
