import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { DispatchQueue } from '../integrations/dispatch.queue';
import { RuleEvaluationJob, RULE_EVALUATION_QUEUE } from './rule-evaluation.queue';
import { evaluateRule, parseConditions, type Severity } from './rule-evaluator';

const TIME_WINDOW_MINUTES = 60;

@Injectable()
export class RuleEvaluationWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<RuleEvaluationJob>;
  private readonly logger = new Logger(RuleEvaluationWorker.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly dispatchQueue: DispatchQueue,
  ) {}

  onModuleInit() {
    this.worker = new Worker<RuleEvaluationJob>(
      RULE_EVALUATION_QUEUE,
      async (job: Job<RuleEvaluationJob>) => this.process(job),
      { connection: this.redis, concurrency: 5 },
    );

    this.worker.on('failed', (job, err) =>
      this.logger.error(`Rule eval job ${job?.id} failed: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker.close();
  }

  private async process(job: Job<RuleEvaluationJob>) {
    const { projectId, bugId, errorId, clusterId, severity } = job.data;

    const rules = await this.prisma.rule.findMany({
      where: { project_id: projectId, is_active: true },
    });

    if (rules.length === 0) return;

    const statusCode = await this.getLastStatusCode(errorId);
    const clusterOccurrences = clusterId ? await this.getClusterOccurrences(clusterId) : 0;
    const uniqueUsers = clusterId ? await this.getUniqueUsers(clusterId) : 0;

    const ctx = { severity: severity as Severity, statusCode, clusterOccurrences, uniqueUsers };

    for (const rule of rules) {
      const conditions = parseConditions(rule.conditions);
      const matched = evaluateRule(conditions, ctx);

      await this.prisma.ruleExecutionLog.create({
        data: {
          rule_id: rule.id,
          bug_id: bugId,
          matched,
          action_taken: matched ? rule.action : null,
        },
      });

      if (!matched) continue;

      this.logger.log(`Rule ${rule.id} matched for bug ${bugId}, action=${rule.action}`);

      if (rule.action === 'auto_dispatch') {
        await this.triggerDispatch(bugId, projectId);
      } else if (rule.action === 'ignore') {
        await this.prisma.bug.update({ where: { id: bugId }, data: { status: 'ignored' } });
      }
    }
  }

  private async triggerDispatch(bugId: string, projectId: string) {
    const integrations = await this.prisma.projectIntegration.findMany({
      where: { project_id: projectId, is_active: true },
    });

    for (const integration of integrations) {
      await this.dispatchQueue.add({ bugId, integrationId: integration.id, attempt: 1 });
    }

    if (integrations.length > 0) {
      await this.prisma.bug.update({ where: { id: bugId }, data: { status: 'dispatched' } });
    }
  }

  private async getLastStatusCode(errorId: string): Promise<number | null> {
    const error = await this.prisma.error.findUnique({
      where: { id: errorId },
      include: { event: true },
    });
    if (!error) return null;

    const apiResp = await this.prisma.event.findFirst({
      where: {
        session_id: error.session_id,
        type: 'api_response',
        timestamp: { lte: error.event.timestamp },
      },
      orderBy: { timestamp: 'desc' },
    });

    const payload = apiResp?.payload as { status?: number } | null;
    return payload?.status ?? null;
  }

  private async getClusterOccurrences(clusterId: string): Promise<number> {
    const cluster = await this.prisma.errorCluster.findUnique({ where: { id: clusterId } });
    return cluster?.occurrence_count ?? 0;
  }

  private async getUniqueUsers(clusterId: string): Promise<number> {
    const since = new Date(Date.now() - TIME_WINDOW_MINUTES * 60 * 1000);
    const result = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT session_id) AS count
      FROM "Error"
      WHERE cluster_id = ${clusterId}::uuid
        AND created_at >= ${since}
    `;
    return Number(result[0]?.count ?? 0);
  }
}
