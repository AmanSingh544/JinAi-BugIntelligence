import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ErrorDetectionQueue } from '../errors/error-detection.queue';
import { IngestJob, INGEST_QUEUE } from './ingest.queue';

@Injectable()
export class IngestWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<IngestJob>;
  private readonly logger = new Logger(IngestWorker.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly errorDetectionQueue: ErrorDetectionQueue,
  ) {}

  onModuleInit() {
    this.worker = new Worker<IngestJob>(
      INGEST_QUEUE,
      async (job: Job<IngestJob>) => this.process(job),
      { connection: this.redis, concurrency: 5 },
    );

    this.worker.on('failed', (job, err) =>
      this.logger.error(`Ingest job ${job?.id} failed: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker.close();
  }

  private async process(job: Job<IngestJob>) {
    const { projectId, sessionId, sessionMeta, events, receivedAt } = job.data;

    // Upsert session
    await this.prisma.session.upsert({
      where: { id: sessionId },
      create: {
        id: sessionId,
        project_id: projectId,
        user_agent: sessionMeta?.userAgent,
        initial_url: sessionMeta?.initialUrl,
      },
      update: { ended_at: new Date() },
    });

    // Batch insert events
    await this.prisma.event.createMany({
      data: events.map((e) => ({
        id: e.id,
        session_id: sessionId,
        project_id: projectId,
        type: e.type,
        timestamp: BigInt(e.timestamp),
        payload: e.payload as object,
      })),
      skipDuplicates: true,
    });

    // Route to error-detection:
    //   type=error          — uncaught JS exceptions
    //   type=console        — console.error() calls
    //   type=api_response   — HTTP 4xx/5xx responses
    for (const e of events) {
      let message: string | null = null;
      let stack: string | undefined;
      let file: string | undefined;
      let line: number | undefined;
      let column: number | undefined;

      if (e.type === 'error') {
        const p = e.payload as { message?: string; stack?: string; file?: string; line?: number; column?: number };
        message = p.message ?? 'Unknown error';
        stack = p.stack;
        file = p.file;
        line = p.line;
        column = p.column;
      } else if (e.type === 'console') {
        const p = e.payload as { level?: string; message?: string };
        if (p.level === 'error') {
          message = `console.error: ${p.message ?? 'Unknown'}`;
        }
      } else if (e.type === 'api_response') {
        const p = e.payload as { status?: number; url?: string; method?: string };
        if (p.status && p.status >= 400) {
          message = `HTTP ${p.status}: ${p.method ?? 'GET'} ${p.url ?? 'Unknown URL'}`;
        }
      }

      if (message) {
        await this.errorDetectionQueue.add({
          projectId,
          sessionId,
          eventId: e.id,
          errorPayload: { message, stack, file, line, column },
        });
      }
    }

    const typeCounts = events.reduce<Record<string, number>>((acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + 1;
      return acc;
    }, {});
    this.logger.debug(
      `Processed ${events.length} events for project ${projectId}, session ${sessionId} — types: ${JSON.stringify(typeCounts)}`,
    );

  }
}
