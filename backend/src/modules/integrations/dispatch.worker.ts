import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { DispatchJob, DispatchQueue, DISPATCH_QUEUE } from './dispatch.queue';
import { IntegrationRegistry } from './providers/integration.registry';
import type { BugReportPayload, JsonValue } from './providers/integration.interface';
import type { Prisma } from '@prisma/client';

const BACKOFF_MS = [0, 30_000, 300_000, 1_800_000, 7_200_000];
const MAX_ATTEMPTS = 5;

@Injectable()
export class DispatchWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<DispatchJob>;
  private readonly logger = new Logger(DispatchWorker.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly registry: IntegrationRegistry,
    private readonly dispatchQueue: DispatchQueue,
  ) {}

  onModuleInit() {
    this.worker = new Worker<DispatchJob>(
      DISPATCH_QUEUE,
      async (job: Job<DispatchJob>) => this.process(job),
      { connection: this.redis, concurrency: 3 },
    );

    this.worker.on('failed', (job, err) =>
      this.logger.error(`Dispatch job ${job?.id} failed: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker.close();
  }

  private async process(job: Job<DispatchJob>) {
    const { bugId, integrationId, attempt } = job.data;

    const [bug, integration] = await Promise.all([
      this.prisma.bug.findUnique({
        where: { id: bugId },
        include: { error: { include: { event: true } }, session: true },
      }),
      this.prisma.projectIntegration.findUnique({ where: { id: integrationId } }),
    ]);

    if (!bug || !integration) {
      this.logger.warn(`Bug ${bugId} or integration ${integrationId} not found`);
      return;
    }

    const payload = this.buildPayload(bug);
    const provider = this.registry.get(integration.provider_id);

    let delivery = await this.prisma.integrationDelivery.findFirst({
      where: { bug_id: bugId, integration_id: integrationId },
    });

    if (!delivery) {
      delivery = await this.prisma.integrationDelivery.create({
        data: { bug_id: bugId, integration_id: integrationId, status: 'retrying', attempts: 0 },
      });
    }

    try {
      const result = await provider.createTicket(payload, integration.config as Record<string, JsonValue>);

      await this.prisma.integrationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'success',
          remote_ticket_id: result.ticketId,
          remote_ticket_url: result.url,
          attempts: attempt,
          response: result as unknown as Prisma.JsonObject,
        },
      });

      this.logger.log(`Dispatched bug ${bugId} → ${provider.name} ticket ${result.ticketId}`);
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`Dispatch attempt ${attempt} failed for bug ${bugId}: ${message}`);

      if (attempt >= MAX_ATTEMPTS) {
        await this.prisma.integrationDelivery.update({
          where: { id: delivery.id },
          data: { status: 'dead', attempts: attempt, response: { error: message } as Prisma.JsonObject },
        });
        await this.dispatchQueue.addToDlq({ bugId, integrationId, attempt });
        this.logger.error(`Bug ${bugId} dispatch dead after ${attempt} attempts`);
        return;
      }

      const delay = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1] ?? 0;
      await this.prisma.integrationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'retrying',
          attempts: attempt,
          next_retry_at: new Date(Date.now() + delay),
        },
      });

      await this.dispatchQueue.add({ bugId, integrationId, attempt: attempt + 1 }, delay);
    }
  }

  private buildPayload(bug: {
    id: string;
    project_id: string;
    session_id: string;
    summary: string | null;
    root_cause: string | null;
    steps_to_reproduce: Prisma.JsonValue;
    fix_suggestion: string | null;
    severity: string | null;
    created_at: Date;
    error: {
      message: string;
      stack: string | null;
      event: { url?: string; payload: Prisma.JsonValue };
    };
    session: { user_agent: string | null };
  }): BugReportPayload {
    const steps = Array.isArray(bug.steps_to_reproduce)
      ? (bug.steps_to_reproduce as string[])
      : [];

    const eventPayload = bug.error.event.payload as { url?: string } | null;

    return {
      bugId: bug.id,
      projectId: bug.project_id,
      summary: bug.summary ?? 'Unknown error',
      rootCause: bug.root_cause ?? 'Unknown',
      stepsToReproduce: steps,
      fixSuggestion: bug.fix_suggestion ?? 'Investigate the error',
      severity: (bug.severity ?? 'medium') as BugReportPayload['severity'],
      errorMessage: bug.error.message,
      stackTrace: bug.error.stack ?? undefined,
      sessionUrl: `http://localhost:5173/sessions/${bug.session_id}`,
      affectedUrl: eventPayload?.url ?? 'Unknown',
      browser: bug.session.user_agent ?? 'Unknown',
      timestamp: bug.created_at.toISOString(),
      sessionId: bug.session_id,
    };
  }
}
