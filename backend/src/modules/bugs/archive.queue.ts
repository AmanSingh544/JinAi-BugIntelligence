import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { MetricsService } from '../../shared/metrics/metrics.service';

export const ARCHIVE_QUEUE = 'archive';

export interface ArchiveJob {
  projectId: string;
  daysOld: number;
  triggeredBy: string;
}

@Injectable()
export class ArchiveQueue {
  private readonly queue: Queue<ArchiveJob>;

  constructor(
    @Inject(REDIS_CLIENT) redis: Redis,
    private readonly metrics: MetricsService,
  ) {
    this.queue = new Queue<ArchiveJob>(ARCHIVE_QUEUE, {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    });
    this.metrics.registerQueue(this.queue);
  }

  async add(data: ArchiveJob) {
    return this.queue.add('archive', data);
  }
}
