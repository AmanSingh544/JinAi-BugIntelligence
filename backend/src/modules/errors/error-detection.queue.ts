import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { MetricsService } from '../../shared/metrics/metrics.service';

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
  releaseId?: string | null;
  trackingId?: string;
}

@Injectable()
export class ErrorDetectionQueue {
  private readonly queue: Queue<ErrorDetectionJob>;

  constructor(
    @Inject(REDIS_CLIENT) redis: Redis,
    private readonly metrics: MetricsService,
  ) {
    this.queue = new Queue<ErrorDetectionJob>(ERROR_DETECTION_QUEUE, {
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

  async add(data: ErrorDetectionJob) {
    await this.queue.add('detect', data);
  }
}
