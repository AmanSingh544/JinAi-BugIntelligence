import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { MetricsService } from '../../shared/metrics/metrics.service';

export const EMBEDDING_QUEUE = 'embedding';

export interface EmbeddingJob {
  errorId: string;
  text: string;
}

@Injectable()
export class EmbeddingQueue {
  private readonly queue: Queue<EmbeddingJob>;

  constructor(
    @Inject(REDIS_CLIENT) redis: Redis,
    metrics: MetricsService,
  ) {
    this.queue = new Queue<EmbeddingJob>(EMBEDDING_QUEUE, {
      connection: redis,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
    metrics.registerQueue(this.queue);
  }

  async add(data: EmbeddingJob) {
    await this.queue.add('generate', data);
  }
}
