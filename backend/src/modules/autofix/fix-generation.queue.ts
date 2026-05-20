import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';

export const FIX_GENERATION_QUEUE = 'fix-generation';

export interface FixGenerationJob {
  bugId: string;
  projectId: string;
  errorId: string;
  requireApproval: boolean;
  trackingId?: string;
}

@Injectable()
export class FixGenerationQueue {
  private queue: Queue<FixGenerationJob>;

  constructor(redis: Redis) {
    this.queue = new Queue<FixGenerationJob>(FIX_GENERATION_QUEUE, {
      connection: redis,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });
  }

  async add(job: FixGenerationJob) {
    return this.queue.add('fix', job);
  }
}
