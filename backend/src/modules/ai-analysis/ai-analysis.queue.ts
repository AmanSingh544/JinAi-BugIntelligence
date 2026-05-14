import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { MetricsService } from '../../shared/metrics/metrics.service';

export const AI_ANALYSIS_QUEUE = 'ai-analysis';

export interface AiAnalysisJob {
  projectId: string;
  sessionId: string;
  errorId: string;
  fingerprint: string;
  trackingId?: string;
}

@Injectable()
export class AiAnalysisQueue {
  private readonly queue: Queue<AiAnalysisJob>;

  constructor(
    @Inject(REDIS_CLIENT) redis: Redis,
    private readonly metrics: MetricsService,
  ) {
    this.queue = new Queue<AiAnalysisJob>(AI_ANALYSIS_QUEUE, {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
    this.metrics.registerQueue(this.queue);
  }

  async add(data: AiAnalysisJob) {
    await this.queue.add('analyze', data);
  }
}
