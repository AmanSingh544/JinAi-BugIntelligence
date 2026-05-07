import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';

export const DISPATCH_QUEUE = 'dispatch';
export const DISPATCH_DLQ = 'dispatch-dlq';

export interface DispatchJob {
  bugId: string;
  integrationId: string;
  attempt: number;
}

@Injectable()
export class DispatchQueue {
  private readonly queue: Queue<DispatchJob>;
  private readonly dlq: Queue<DispatchJob>;

  constructor(@Inject(REDIS_CLIENT) redis: Redis) {
    this.queue = new Queue<DispatchJob>(DISPATCH_QUEUE, {
      connection: redis,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 500,
        removeOnFail: 1000,
      },
    });

    this.dlq = new Queue<DispatchJob>(DISPATCH_DLQ, {
      connection: redis,
      defaultJobOptions: { removeOnComplete: false, removeOnFail: false },
    });
  }

  async add(data: DispatchJob, delayMs = 0) {
    await this.queue.add('dispatch', data, { delay: delayMs });
  }

  async addToDlq(data: DispatchJob) {
    await this.dlq.add('dead', data);
  }
}
