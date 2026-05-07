import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';

export const ERROR_DETECTION_QUEUE = 'error-detection';

export interface ErrorDetectionJob {
  projectId: string;
  sessionId: string;
  eventId: string;
  errorPayload: {
    message: string;
    stack?: string;
    file?: string;
    line?: number;
    column?: number;
  };
}

@Injectable()
export class ErrorDetectionQueue {
  private readonly queue: Queue<ErrorDetectionJob>;

  constructor(@Inject(REDIS_CLIENT) redis: Redis) {
    this.queue = new Queue<ErrorDetectionJob>(ERROR_DETECTION_QUEUE, {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
  }

  async add(data: ErrorDetectionJob) {
    await this.queue.add('detect', data);
  }
}
