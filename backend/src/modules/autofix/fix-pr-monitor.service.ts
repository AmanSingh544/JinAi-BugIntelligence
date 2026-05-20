import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { GitHubAppService } from './github-app.service';

const MONITOR_QUEUE = 'fix-pr-monitor';
const MONITOR_JOB = 'scan-stale-prs';

@Injectable()
export class FixPrMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FixPrMonitorService.name);
  private queue: Queue;
  private worker: Worker;
  private readonly staleDays: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly github: GitHubAppService,
    private readonly config: ConfigService,
  ) {
    this.staleDays = parseInt(this.config.get<string>('AUTOFIX_STALE_PR_DAYS') ?? '7', 10);
  }

  onModuleInit() {
    this.queue = new Queue(MONITOR_QUEUE, {
      connection: this.redis,
      defaultJobOptions: { removeOnComplete: 5, removeOnFail: 5 },
    });

    this.worker = new Worker(
      MONITOR_QUEUE,
      async (job: Job) => {
        if (job.name === MONITOR_JOB) await this.scanStalePrs();
      },
      { connection: this.redis, concurrency: 1 },
    );

    this.worker.on('failed', (job, err) =>
      this.logger.error(`PR monitor job failed: ${err.message}`),
    );

    // Schedule repeatable scan every 5 minutes
    void this.queue.add(
      MONITOR_JOB,
      {},
      { repeat: { every: 5 * 60 * 1000 }, jobId: 'stale-pr-scan' },
    );

    this.logger.log(`Stale PR monitor started — stale threshold: ${this.staleDays} days`);
  }

  async onModuleDestroy() {
    await this.worker.close();
    await this.queue.close();
  }

  private async scanStalePrs() {
    const staleThreshold = new Date();
    staleThreshold.setDate(staleThreshold.getDate() - this.staleDays);

    // Find attempts that have been in pr_open status past the threshold
    const staleAttempts = await this.prisma.bugFixAttempt.findMany({
      where: {
        status: 'pr_open',
        updated_at: { lt: staleThreshold },
        pr_number: { not: null },
      },
      include: { repository: true },
    });

    if (staleAttempts.length === 0) {
      this.logger.debug('No stale PRs found');
      return;
    }

    this.logger.log(`Found ${staleAttempts.length} stale PR(s) — checking GitHub state`);

    for (const attempt of staleAttempts) {
      await this.reconcileAttempt(attempt);
    }
  }

  private async reconcileAttempt(attempt: {
    id: string;
    bug_id: string;
    pr_number: number | null;
    branch_name: string | null;
    repository: { installation_id: number; github_owner: string; github_repo: string };
  }) {
    const { installation_id, github_owner, github_repo } = attempt.repository;

    try {
      const res = await this.github.apiRequest(
        installation_id,
        `/repos/${github_owner}/${github_repo}/pulls/${attempt.pr_number}`,
      );

      if (!res.ok) {
        this.logger.warn(`Could not fetch PR #${attempt.pr_number} [${res.status}] for attempt=${attempt.id}`);
        return;
      }

      const pr = (await res.json()) as { state: string; merged: boolean };

      if (pr.merged) {
        this.logger.log(`Stale check: PR #${attempt.pr_number} was already merged — syncing attempt=${attempt.id}`);
        await this.prisma.bugFixAttempt.update({
          where: { id: attempt.id },
          data: { status: 'merged', pr_merged_at: new Date() },
        });
        await this.prisma.bug.update({
          where: { id: attempt.bug_id },
          data: { fix_status: 'merged', status: 'resolved' },
        });
      } else if (pr.state === 'closed') {
        this.logger.log(`Stale check: PR #${attempt.pr_number} was closed — cancelling attempt=${attempt.id}`);
        await this.prisma.bugFixAttempt.update({
          where: { id: attempt.id },
          data: { status: 'cancelled', failure_reason: 'PR closed without merging (detected by stale monitor)' },
        });
        await this.prisma.bug.update({
          where: { id: attempt.bug_id },
          data: { fix_status: null },
        });
      } else {
        // Still open but stale — close it and cancel
        this.logger.warn(`PR #${attempt.pr_number} is stale (>${this.staleDays} days open) — closing`);
        await this.closeStalePr(installation_id, github_owner, github_repo, attempt.pr_number!);
        await this.prisma.bugFixAttempt.update({
          where: { id: attempt.id },
          data: { status: 'cancelled', failure_reason: `PR closed by autofix monitor after ${this.staleDays} days with no activity` },
        });
        await this.prisma.bug.update({
          where: { id: attempt.bug_id },
          data: { fix_status: null },
        });
      }
    } catch (err) {
      this.logger.warn(`Failed to reconcile attempt=${attempt.id}: ${(err as Error).message}`);
    }
  }

  private async closeStalePr(
    installationId: number,
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<void> {
    const res = await this.github.apiRequest(
      installationId,
      `/repos/${owner}/${repo}/pulls/${prNumber}`,
      { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) },
    );
    if (!res.ok) {
      this.logger.warn(`Failed to close stale PR #${prNumber} [${res.status}]`);
    }
  }
}
