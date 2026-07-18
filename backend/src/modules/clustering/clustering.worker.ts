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
import { ClusteringJob, CLUSTERING_QUEUE } from './clustering.queue';
import { MetricsService } from '../../shared/metrics/metrics.service';

@Injectable()
export class ClusteringWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<ClusteringJob>;
  private readonly logger = new Logger(ClusteringWorker.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit() {
    this.worker = new Worker<ClusteringJob>(
      CLUSTERING_QUEUE,
      async (job: Job<ClusteringJob>) => this.process(job),
      { connection: this.redis, concurrency: 2 },
    );

    this.worker.on('failed', (job, err) =>
      this.logger.error(`Clustering job ${job?.id} failed: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker.close();
  }

  private async process(job: Job<ClusteringJob>) {
    return this.metrics.wrapJob('clustering', async () => {
      const { projectId, errorId, vector } = job.data;

      const [project, error] = await Promise.all([
        this.prisma.project.findUnique({ where: { id: projectId } }),
        this.prisma.error.findUnique({
          where: { id: errorId },
          select: { cluster_id: true },
        }),
      ]);
      if (!project || !error) return;

      // If the AI-analysis worker already attached this error to a fingerprint-based
      // cluster, fold the vector into that cluster's centroid so it becomes searchable
      // by similarity. Occurrence count was already incremented there — don't double-count.
      if (error.cluster_id) {
        await this.foldIntoCentroid(error.cluster_id, vector, {
          incrementCount: false,
        });
        this.logger.debug(
          `Updated centroid of cluster=${error.cluster_id} for error=${errorId}`,
        );
        return;
      }

      const threshold = project.clustering_threshold;
      const vectorLiteral = JSON.stringify(vector);

      const nearest = await this.prisma.$queryRaw<
        { id: string; distance: number }[]
      >`
      SELECT id, (centroid <=> ${vectorLiteral}::vector) AS distance
      FROM "ErrorCluster"
      WHERE project_id = ${projectId}::uuid AND centroid IS NOT NULL
      ORDER BY centroid <=> ${vectorLiteral}::vector
      LIMIT 1
    `;

      let clusterId: string;

      if (
        nearest.length > 0 &&
        nearest[0].distance !== null &&
        nearest[0].distance <= threshold
      ) {
        clusterId = nearest[0].id;
        await this.foldIntoCentroid(clusterId, vector, {
          incrementCount: true,
        });
        this.logger.debug(
          `Assigned error=${errorId} to existing cluster=${clusterId}`,
        );
      } else {
        const result = await this.prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO "ErrorCluster" (id, project_id, centroid, occurrence_count, last_seen_at, created_at)
        VALUES (gen_random_uuid(), ${projectId}::uuid, ${vectorLiteral}::vector, 1, NOW(), NOW())
        RETURNING id
      `;
        clusterId = result[0]?.id ?? '';
        this.logger.debug(
          `Created new cluster=${clusterId} for error=${errorId}`,
        );
      }

      if (clusterId) {
        await this.prisma.error.update({
          where: { id: errorId },
          data: { cluster_id: clusterId },
        });
      }
    });
  }

  /**
   * Fold a vector into a cluster's centroid as a running mean.
   * pgvector has no scalar*vector / vector/scalar operators, so the mean is
   * computed in JS inside a transaction with a row lock to avoid lost updates.
   */
  private async foldIntoCentroid(
    clusterId: string,
    vector: number[],
    opts: { incrementCount: boolean },
  ) {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { centroid: string | null; occurrence_count: number }[]
      >`
        SELECT centroid::text AS centroid, occurrence_count
        FROM "ErrorCluster" WHERE id = ${clusterId}::uuid FOR UPDATE
      `;
      if (rows.length === 0) return;

      const n = opts.incrementCount
        ? rows[0].occurrence_count + 1
        : Math.max(rows[0].occurrence_count, 1);
      const current = rows[0].centroid
        ? (JSON.parse(rows[0].centroid) as number[])
        : null;
      const next = current
        ? current.map((c, i) => c + ((vector[i] ?? c) - c) / n)
        : vector;
      const nextLiteral = JSON.stringify(next);

      if (opts.incrementCount) {
        await tx.$executeRaw`
          UPDATE "ErrorCluster"
          SET centroid = ${nextLiteral}::vector, occurrence_count = occurrence_count + 1, last_seen_at = NOW()
          WHERE id = ${clusterId}::uuid
        `;
      } else {
        await tx.$executeRaw`
          UPDATE "ErrorCluster"
          SET centroid = ${nextLiteral}::vector, last_seen_at = NOW()
          WHERE id = ${clusterId}::uuid
        `;
      }
    });
  }
}
