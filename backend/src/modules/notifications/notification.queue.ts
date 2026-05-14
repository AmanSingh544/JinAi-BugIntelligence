import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { MetricsService } from '../../shared/metrics/metrics.service';

export const NOTIFICATION_QUEUE = 'notification';

export interface NotificationJob {
  channelId: string;
  bugId: string;
  logId: string;
  attempt: number;
}

@Injectable()
export class NotificationQueue {
  private readonly queue: Queue<NotificationJob>;

  constructor(
    @Inject(REDIS_CLIENT) redis: Redis,
    private readonly metrics: MetricsService,
  ) {
    this.queue = new Queue<NotificationJob>(NOTIFICATION_QUEUE, {
      connection: redis,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 500,
        removeOnFail: 1000,
      },
    });
    this.metrics.registerQueue(this.queue);
  }

  async add(data: NotificationJob, delayMs = 0) {
    await this.queue.add('notify', data, { delay: delayMs });
  }
}
