import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { MetricsService } from '../../shared/metrics/metrics.service';

export const CLUSTERING_QUEUE = 'clustering';

export interface ClusteringJob {
  projectId: string;
  errorId: string;
  vector: number[];
}

@Injectable()
export class ClusteringQueue {
  private readonly queue: Queue<ClusteringJob>;

  constructor(
    @Inject(REDIS_CLIENT) redis: Redis,
    private readonly metrics: MetricsService,
  ) {
    this.queue = new Queue<ClusteringJob>(CLUSTERING_QUEUE, {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
    this.metrics.registerQueue(this.queue);
  }

  async add(data: ClusteringJob) {
    await this.queue.add('cluster', data);
  }
}
