import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ArchiveJob, ARCHIVE_QUEUE } from './archive.queue';
import { bugVisibilityWhere } from '../../shared/helpers/bug-visibility.helper';

const BATCH_SIZE = 1000;

@Injectable()
export class ArchiveWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<ArchiveJob>;
  private readonly logger = new Logger(ArchiveWorker.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.worker = new Worker<ArchiveJob>(
      ARCHIVE_QUEUE,
      async (job: Job<ArchiveJob>) => this.process(job),
      { connection: this.redis, concurrency: 1 },
    );

    this.worker.on('failed', (job, err) =>
      this.logger.error(`Archive job ${job?.id} failed: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker.close();
  }

  private async process(job: Job<ArchiveJob>) {
    const { projectId, daysOld, triggeredBy } = job.data;
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    let totalArchived = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const rows = await this.prisma.bug.findMany({
        where: {
          project_id: projectId,
          ...bugVisibilityWhere(false),
          status: { in: ['resolved', 'ignored'] },
          created_at: { lt: cutoff },
        },
        select: { id: true },
        take: BATCH_SIZE,
      });

      if (rows.length === 0) break;

      const ids = rows.map((r) => r.id);
      const { count } = await this.prisma.bug.updateMany({
        where: { id: { in: ids } },
        data: { archived_at: new Date() },
      });

      totalArchived += count;
      this.logger.log(`Archived ${count} bugs for project ${projectId} (batch)`);
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { tenant_id: true },
    });

    await this.audit.log({
      tenantId: project?.tenant_id ?? '',
      actorId: triggeredBy,
      action: 'bugs_archived',
      entityType: 'project',
      entityId: projectId,
      metadata: { projectId, daysOld, totalArchived },
    });

    this.logger.log(`Archive job completed for project ${projectId}: ${totalArchived} bugs archived`);
    return { totalArchived };
  }
}
