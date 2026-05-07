import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';

export const RULE_EVALUATION_QUEUE = 'rule-evaluation';

export interface RuleEvaluationJob {
  projectId: string;
  bugId: string;
  errorId: string;
  clusterId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

@Injectable()
export class RuleEvaluationQueue {
  private readonly queue: Queue<RuleEvaluationJob>;

  constructor(@Inject(REDIS_CLIENT) redis: Redis) {
    this.queue = new Queue<RuleEvaluationJob>(RULE_EVALUATION_QUEUE, {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
  }

  async add(data: RuleEvaluationJob) {
    await this.queue.add('evaluate', data);
  }
}
