import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ErrorDetectionQueue } from '../errors/error-detection.queue';
import { EnvironmentService } from '../environments/environment.service';
import { SanitizationService } from './sanitization.service';
import { EventType } from '../../shared/types/event-type.enum';
import { IngestJob, INGEST_QUEUE } from './ingest.queue';
import { MetricsService } from '../../shared/metrics/metrics.service';

const SAMPLING_FIELD_MAP: Record<string, string> = {
  click: 'sampling_click',
  input: 'sampling_click',
  navigation: 'sampling_navigation',
  console: 'sampling_console',
  api_request: 'sampling_api',
  api_response: 'sampling_api',
};

@Injectable()
export class IngestWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<IngestJob>;
  private readonly logger = new Logger(IngestWorker.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly errorDetectionQueue: ErrorDetectionQueue,
    private readonly envService: EnvironmentService,
    private readonly sanitization: SanitizationService,
    private readonly metrics: MetricsService,
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
    return this.metrics.wrapJob('ingest', async () => {
    const { projectId, sessionId, sessionMeta, environmentName, events, receivedAt } = job.data;

    // Resolve environment
    const env = await this.envService.resolveEnvironment(projectId, environmentName);
    const envId = env?.id ?? null;

    // Safety-net sampling: never drop errors or unhandled rejections
    const filteredEvents = events.filter((e) => {
      if (e.type === EventType.ERROR) return true;

      const field = SAMPLING_FIELD_MAP[e.type];
      if (!field || !env) return true; // if no env config, accept everything

      const rate = (env as Record<string, unknown>)[field] as number;
      return Math.random() < (rate ?? 1.0);
    });

    // Resolve release from session metadata
    let releaseId: string | null = null;
    if (sessionMeta?.release) {
      const release = await this.prisma.release.findUnique({
        where: { project_id_version: { project_id: projectId, version: sessionMeta.release } },
      });
      releaseId = release?.id ?? null;
    }

    // Upsert session
    await this.prisma.session.upsert({
      where: { id: sessionId },
      create: {
        id: sessionId,
        project_id: projectId,
        environment_id: envId,
        user_agent: sessionMeta?.userAgent,
        initial_url: sessionMeta?.initialUrl,
        metadata: { release: sessionMeta?.release ?? null },
      },
      update: { ended_at: new Date() },
    });

    // Separate replay snapshots from regular events
    const regularEvents = filteredEvents.filter((e) => e.type !== EventType.REPLAY_SNAPSHOT);
    const replayEvents = filteredEvents.filter((e) => e.type === EventType.REPLAY_SNAPSHOT);

    // Batch insert regular events
    if (regularEvents.length > 0) {
      await this.prisma.event.createMany({
        data: regularEvents.map((e) => ({
          id: e.id,
          session_id: sessionId,
          project_id: projectId,
          type: e.type,
          timestamp: BigInt(e.timestamp),
          payload: this.sanitization.sanitizePayload(e.payload as unknown as object) as object,
        })),
        skipDuplicates: true,
      });
    }

    // Store replay segments
    for (const e of replayEvents) {
      const payload = e.payload as { events?: unknown[] } | null;
      if (payload?.events && payload.events.length > 0) {
        await this.prisma.replaySegment.create({
          data: {
            session_id: sessionId,
            project_id: projectId,
            sequence: 1,
            events: payload.events as object,
          },
        });
      }
    }

    // Route to error-detection
    for (const e of filteredEvents) {
      let message: string | null = null;
      let stack: string | undefined;
      let file: string | undefined;
      let line: number | undefined;
      let column: number | undefined;

      if (e.type === EventType.ERROR) {
        const p = e.payload as { message?: string; stack?: string; file?: string; line?: number; column?: number };
        message = p.message ?? 'Unknown error';
        stack = p.stack;
        file = p.file;
        line = p.line;
        column = p.column;
      } else if (e.type === EventType.CONSOLE) {
        const p = e.payload as { level?: string; message?: string };
        if (p.level === 'error') {
          message = `console.error: ${p.message ?? 'Unknown'}`;
        }
      } else if (e.type === EventType.API_RESPONSE) {
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
          releaseId,
        });
      }
    }

    const typeCounts = filteredEvents.reduce<Record<string, number>>((acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + 1;
      return acc;
    }, {});
    this.logger.debug(
      `Processed ${filteredEvents.length}/${events.length} events for project ${projectId}, session ${sessionId} — types: ${JSON.stringify(typeCounts)}`,
    );
    });
  }
}
