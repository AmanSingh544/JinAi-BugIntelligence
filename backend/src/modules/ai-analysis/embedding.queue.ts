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
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });
    metrics.registerQueue(this.queue);
  }

  async add(data: EmbeddingJob) {
    await this.queue.add('generate', data);
  }
}
