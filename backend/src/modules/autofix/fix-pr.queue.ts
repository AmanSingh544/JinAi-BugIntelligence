import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';

export const FIX_PR_QUEUE = 'fix-pr-creation';

export interface FixPrJob {
  attemptId: string;
  bugId: string;
  projectId: string;
}

@Injectable()
export class FixPrQueue {
  private queue: Queue<FixPrJob>;

  constructor(redis: Redis) {
    this.queue = new Queue<FixPrJob>(FIX_PR_QUEUE, {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });
  }

  async add(job: FixPrJob) {
    return this.queue.add('create-pr', job);
  }
}
