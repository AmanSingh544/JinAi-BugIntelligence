import { Injectable, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';

interface QueueInfo {
  name: string;
  queue: Queue;
  slaMs: number;
}

@Injectable()
export class QueueMetricsService implements OnModuleInit {
  private queues: QueueInfo[] = [];

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  onModuleInit() {
    this.queues = [
      { name: 'ingest', queue: new Queue('ingest', { connection: this.redis }), slaMs: 60_000 },
      { name: 'error-detection', queue: new Queue('error-detection', { connection: this.redis }), slaMs: 300_000 },
      { name: 'ai-analysis', queue: new Queue('ai-analysis', { connection: this.redis }), slaMs: 600_000 },
      { name: 'clustering', queue: new Queue('clustering', { connection: this.redis }), slaMs: 300_000 },
      { name: 'rule-evaluation', queue: new Queue('rule-evaluation', { connection: this.redis }), slaMs: 300_000 },
      { name: 'dispatch', queue: new Queue('dispatch', { connection: this.redis }), slaMs: 900_000 },
    ];
  }

  async getQueueStatuses(): Promise<
    Array<{
      name: string;
      waiting: number;
      active: number;
      delayed: number;
      failed: number;
      oldestWaitingMs?: number;
      stalled: boolean;
    }>
  > {
    const results: Array<{
      name: string;
      waiting: number;
      active: number;
      delayed: number;
      failed: number;
      oldestWaitingMs?: number;
      stalled: boolean;
    }> = [];
    for (const { name, queue, slaMs } of this.queues) {
      const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');

      let oldestWaitingMs: number | undefined;
      let stalled = false;

      const waitingJobs = await queue.getJobs(['waiting'], 0, 0, true);
      if (waitingJobs.length > 0 && waitingJobs[0]) {
        oldestWaitingMs = Date.now() - waitingJobs[0].timestamp;
        stalled = oldestWaitingMs > slaMs;
      }

      results.push({
        name,
        waiting: counts.waiting,
        active: counts.active,
        delayed: counts.delayed,
        failed: counts.failed,
        oldestWaitingMs,
        stalled,
      });
    }
    return results;
  }
}
