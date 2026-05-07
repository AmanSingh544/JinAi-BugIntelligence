import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ClusteringJob, CLUSTERING_QUEUE } from './clustering.queue';

@Injectable()
export class ClusteringWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<ClusteringJob>;
  private readonly logger = new Logger(ClusteringWorker.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
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
    const { projectId, errorId, vector } = job.data;

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return;

    const threshold = project.clustering_threshold;
    const vectorLiteral = JSON.stringify(vector);

    const nearest = await this.prisma.$queryRaw<{ id: string; distance: number }[]>`
      SELECT id, (centroid <=> ${vectorLiteral}::vector) AS distance
      FROM "ErrorCluster"
      WHERE project_id = ${projectId}::uuid
      ORDER BY centroid <=> ${vectorLiteral}::vector
      LIMIT 1
    `;

    let clusterId: string;

    if (nearest.length > 0 && nearest[0] !== undefined && nearest[0].distance <= threshold) {
      clusterId = nearest[0].id;

      await this.prisma.$executeRaw`
        UPDATE "ErrorCluster"
        SET
          centroid = (
            SELECT ((occurrence_count * centroid) + ${vectorLiteral}::vector) / (occurrence_count + 1)
            FROM "ErrorCluster" WHERE id = ${clusterId}::uuid
          ),
          occurrence_count = occurrence_count + 1,
          last_seen_at = NOW()
        WHERE id = ${clusterId}::uuid
      `;

      this.logger.debug(`Assigned error=${errorId} to existing cluster=${clusterId}`);
    } else {
      const result = await this.prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO "ErrorCluster" (id, project_id, centroid, occurrence_count, last_seen_at, created_at)
        VALUES (gen_random_uuid(), ${projectId}::uuid, ${vectorLiteral}::vector, 1, NOW(), NOW())
        RETURNING id
      `;
      clusterId = result[0]?.id ?? '';
      this.logger.debug(`Created new cluster=${clusterId} for error=${errorId}`);
    }

    await this.prisma.error.update({
      where: { id: errorId },
      data: { cluster_id: clusterId },
    });

    this.logger.debug(`Cluster ${clusterId} assigned to error ${errorId}`);
  }
}
