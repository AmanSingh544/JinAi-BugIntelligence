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
        // 4 attempts at 15s/30s/60s spacing — wide enough to ride out a
        // provider rate-limit window instead of failing inside it
        attempts: 4,
        backoff: { type: 'exponential', delay: 15000 },
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
