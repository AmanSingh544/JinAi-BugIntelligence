import { Controller, Get, Param, Post, Query, UseGuards, Body, ForbiddenException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { TenantAuthGuard } from '../auth/tenant-auth.guard';
import { CurrentTenant } from '../../shared/tenant/current-tenant.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import type { TenantContext } from '../../shared/tenant/tenant-context';
import { Inject } from '@nestjs/common';
import { AuthorizationService } from '../auth/authorization.service';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { RetentionService } from '../retention/retention.service';
import { PipelineTrackerService } from './pipeline-tracker.service';
import { ErrorDetectionQueue } from '../errors/error-detection.queue';
import { QueueMetricsService } from './queue-metrics.service';
import { DispatchQueue } from '../integrations/dispatch.queue';

@ApiTags('system')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantAuthGuard)
@Controller('system')
export class SystemController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly retentionService: RetentionService,
    private readonly tracker: PipelineTrackerService,
    private readonly errorDetectionQueue: ErrorDetectionQueue,
    private readonly queueMetrics: QueueMetricsService,
    private readonly authz: AuthorizationService,
  ) {}

  @Get('health')
  async health() {
    const providerStats = await this.prisma.$queryRaw<Array<{ provider_id: string; errors: bigint }>>`
      SELECT pi.provider_id, COUNT(*) as errors
      FROM "IntegrationDelivery" id
      JOIN "ProjectIntegration" pi ON id.integration_id = pi.id
      WHERE id.status = 'dead'
        AND id.created_at >= NOW() - INTERVAL '1 hour'
      GROUP BY pi.provider_id
    `;

    // Fetch Redis cooldown and failure counts for active integrations
    const integrationIds = await this.prisma.projectIntegration.findMany({
      where: { is_active: true },
      select: { id: true, provider_id: true },
    });

    const providers: Record<
      string,
      { errors_last_hour: number; status: string; cooldown?: string; failures_last_5m?: number }
    > = {};

    for (const stat of providerStats) {
      providers[stat.provider_id] = {
        errors_last_hour: Number(stat.errors),
        status: Number(stat.errors) > 5 ? 'degraded' : 'healthy',
      };
    }

    for (const int of integrationIds) {
      const base = providers[int.provider_id] ?? { errors_last_hour: 0, status: 'healthy' };

      const cooldownUntil = await this.redis.get(`provider:cooldown:${int.id}`);
      const failureCount = await this.redis.get(`provider:failure_count:${int.id}`);

      if (cooldownUntil) {
        base.cooldown = new Date(parseInt(cooldownUntil, 10)).toISOString();
        base.status = 'cooldown';
      }
      if (failureCount) {
        base.failures_last_5m = Number(failureCount);
      }

      providers[int.provider_id] = base;
    }

    // Notification channel health
    const channelIds = await this.prisma.notificationChannel.findMany({
      where: { is_active: true },
      select: { id: true, provider_id: true },
    });

    const notificationChannels: Record<string, { status: string; cooldown?: string; failures_last_5m?: number }> = {};
    for (const ch of channelIds) {
      const base: { status: string; cooldown?: string; failures_last_5m?: number } = { status: 'healthy' };
      const cooldownUntil = await this.redis.get(`channel:cooldown:${ch.id}`);
      const failureCount = await this.redis.get(`channel:failure_count:${ch.id}`);

      if (cooldownUntil) {
        base.cooldown = new Date(parseInt(cooldownUntil, 10)).toISOString();
        base.status = 'cooldown';
      }
      if (failureCount) {
        base.failures_last_5m = Number(failureCount);
      }

      notificationChannels[ch.provider_id] = base;
    }

    const queues = await this.queueMetrics.getQueueStatuses();

    return {
      queues,
      providers,
      notification_channels: notificationChannels,
      uploads: {
        screenshot_failures_last_hour: 0,
        replay_failures_last_hour: 0,
      },
    };
  }

  @Post('retention/cleanup')
  async triggerRetentionCleanup() {
    await this.retentionService.runCleanup();
    return { triggered: true };
  }

  @Post('synthetic-error')
  async injectSyntheticError(
    @Body() body: { projectId?: string; message?: string },
    @CurrentUser('sub') userId: string,
  ) {
    const trackingId = `synth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Use provided project or first available project the user can access
    let project: { id: string } | null = null;
    if (body.projectId) {
      const canManage = await this.authz.canManageProject(userId, body.projectId);
      if (!canManage) {
        throw new ForbiddenException('You do not have permission to inject synthetic errors into this project');
      }
      project = await this.prisma.project.findUnique({ where: { id: body.projectId } });
    } else {
      const membership = await this.prisma.tenantMember.findFirst({
        where: { user_id: userId },
        orderBy: { created_at: 'asc' },
      });
      if (membership) {
        project = await this.prisma.project.findFirst({
          where: { tenant_id: membership.tenant_id },
        });
      }
    }

    if (!project) {
      return { error: 'No project available for synthetic test' };
    }

    const env = await this.prisma.projectEnvironment.findFirst({
      where: { project_id: project.id },
    });

    // Create synthetic session
    const session = await this.prisma.session.create({
      data: {
        project_id: project.id,
        environment_id: env?.id ?? null,
        user_agent: 'SyntheticTest/1.0',
        initial_url: 'https://synthetic.test/',
      },
    });

    // Create synthetic event
    const event = await this.prisma.event.create({
      data: {
        session_id: session.id,
        project_id: project.id,
        type: 'error',
        timestamp: BigInt(Date.now()),
        payload: { url: 'https://synthetic.test/', synthetic: true },
      },
    });

    // Start tracking
    await this.tracker.startTracking(trackingId);

    // Enqueue error detection with synthetic marker
    await this.errorDetectionQueue.add({
      projectId: project.id,
      sessionId: session.id,
      eventId: event.id,
      errorPayload: {
        message: body.message ?? 'Synthetic test error',
        stack: 'Error: Synthetic\n    at Synthetic.test:1:1',
      },
      trackingId,
    });

    return { trackingId, projectId: project.id, sessionId: session.id, eventId: event.id };
  }

  @Get('synthetic-error/:trackingId')
  async getSyntheticStatus(@Param('trackingId') trackingId: string) {
    const status = await this.tracker.getSyntheticStatus(trackingId);
    if (!status) {
      return { error: 'Tracking ID not found or expired' };
    }
    return status;
  }

  @Get('metrics')
  async getMetrics() {
    const stages = ['detection', 'ai_analysis', 'rule_evaluation', 'dispatch'] as const;
    const latency: Record<string, { count: number; avgMs: number; p95Ms: number }> = {};

    for (const stage of stages) {
      latency[stage] = await this.tracker.getLatencyStats(stage);
    }

    const queues = await this.queueMetrics.getQueueStatuses();

    return {
      latency,
      queues,
    };
  }
}

@ApiTags('system')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantAuthGuard)
@Controller('projects/:projectId/dlq')
export class DlqController {
  constructor(private readonly dispatchQueue: DispatchQueue) {}

  @Get()
  async list(@Query('limit') limit?: string) {
    const jobs = await this.dispatchQueue.getDlqJobs(limit ? parseInt(limit, 10) : 50);
    return {
      jobs: jobs.map((j) => ({
        id: j.id,
        name: j.name,
        data: j.data,
        failedReason: j.failedReason,
        stacktrace: j.stacktrace,
        attemptsMade: j.attemptsMade,
        timestamp: j.timestamp,
      })),
    };
  }

  @Post(':jobId/retry')
  async retry(@Param('jobId') jobId: string) {
    await this.dispatchQueue.retryDlqJob(jobId);
    return { retried: true };
  }
}
