import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { MetricsService } from '../../shared/metrics/metrics.service';

export const DISPATCH_QUEUE = 'dispatch';
export const DISPATCH_DLQ = 'dispatch-dlq';

export interface DispatchJob {
  bugId: string;
  integrationId: string;
  attempt: number;
  trackingId?: string;
}

@Injectable()
export class DispatchQueue {
  private readonly queue: Queue<DispatchJob>;
  private readonly dlq: Queue<DispatchJob>;

  constructor(
    @Inject(REDIS_CLIENT) redis: Redis,
    private readonly metrics: MetricsService,
  ) {
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
    this.metrics.registerQueue(this.queue);
    this.metrics.registerQueue(this.dlq);
  }

  async add(data: DispatchJob, delayMs = 0) {
    await this.queue.add('dispatch', data, { delay: delayMs });
  }

  async addToDlq(data: DispatchJob) {
    await this.dlq.add('dead', data);
  }

  async getDlqJobs(limit = 50) {
    return this.dlq.getJobs(['failed', 'delayed', 'waiting'], 0, limit, true);
  }

  async retryDlqJob(jobId: string) {
    const job = await this.dlq.getJob(jobId);
    if (!job) throw new Error('Job not found in DLQ');
    await this.queue.add('dispatch', job.data);
    await job.remove();
  }
}
