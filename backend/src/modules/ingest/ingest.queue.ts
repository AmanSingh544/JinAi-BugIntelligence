import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { MetricsService } from '../../shared/metrics/metrics.service';
import { RawEventDto } from './dto/batch-events.dto';

export const INGEST_QUEUE = 'ingest';

export interface IngestJob {
  projectId: string;
  sessionId: string;
  sessionMeta?: { userAgent?: string; initialUrl?: string; release?: string };
  environmentName: string | null;
  events: RawEventDto[];
  receivedAt: number;
}

@Injectable()
export class IngestQueue {
  private readonly queue: Queue<IngestJob>;

  constructor(
    @Inject(REDIS_CLIENT) redis: Redis,
    private readonly metrics: MetricsService,
  ) {
    this.queue = new Queue<IngestJob>(INGEST_QUEUE, {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
    this.metrics.registerQueue(this.queue);
  }

  async add(data: IngestJob) {
    await this.queue.add('process', data);
  }
}
