import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PaginationDto, PaginatedResult } from '../../shared/dto/pagination.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/tenant-auth.guard';
import { AuthorizationService } from '../auth/authorization.service';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { CurrentTenant } from '../../shared/tenant/current-tenant.decorator';
import type { TenantContext } from '../../shared/tenant/tenant-context';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventsSseService } from '../events/events-sse.service';
import { SearchBugsDto } from './dto/search-bugs.dto';
import { ArchiveOldBugsDto } from './dto/archive-old-bugs.dto';
import { bugVisibilityWhere } from '../../shared/helpers/bug-visibility.helper';
import { ArchiveQueue } from './archive.queue';

interface SimilarBug {
  id: string;
  summary: string | null;
  severity: string | null;
  status: string;
  createdAt: Date;
  distance: number;
}

interface ClusterMember {
  id: string;
  summary: string | null;
  severity: string | null;
  status: string;
  createdAt: Date;
  errorMessage: string;
}

class UpdateStatusDto {
  @IsIn(['open', 'dispatched', 'resolved', 'ignored'])
  status!: string;
}

class AssignBugDto {
  userId!: string;
}

class BulkStatusDto {
  bugIds!: string[];
  status!: string;
}

@ApiTags('bugs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantAuthGuard)
@Controller('projects/:projectId/bugs')
export class BugsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly sse: EventsSseService,
    private readonly archiveQueue: ArchiveQueue,
  ) {}

  @Get()
  async findAll(
    @Param('projectId') projectId: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenant() tenant: TenantContext,
    @Query() query: SearchBugsDto,
  ): Promise<PaginatedResult<unknown>> {
    const where: any = {
      project_id: projectId,
      ...bugVisibilityWhere(query.includeArchived === 'true'),
    };

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { summary: { contains: term, mode: 'insensitive' } },
        { error: { message: { contains: term, mode: 'insensitive' } } },
      ];
    }

    if (query.severities && query.severities.length > 0) {
      where.severity = { in: query.severities };
    }

    if (query.statuses && query.statuses.length > 0) {
      where.status = { in: query.statuses };
    }

    if (query.dateFrom || query.dateTo) {
      where.created_at = {};
      if (query.dateFrom) where.created_at.gte = new Date(query.dateFrom);
      if (query.dateTo) where.created_at.lte = new Date(query.dateTo);
    }

    if (query.assignedTo) {
      if (query.assignedTo === 'unassigned') {
        where.assigned_to = null;
      } else if (query.assignedTo === 'me') {
        where.assigned_to = userId;
      } else {
        where.assigned_to = query.assignedTo;
      }
    }

    if (query.hasRegression === 'true') {
      where.regression_detected_at = { not: null };
    }

    const orderBy: any = {};
    orderBy[query.sortBy ?? 'created_at'] = query.sortOrder ?? 'desc';

    const skip = ((query.page ?? 1) - 1) * (query.limit ?? 20);
    const [items, total] = await Promise.all([
      this.prisma.bug.findMany({
        where,
        orderBy,
        skip,
        take: query.limit,
        include: {
          assignee: { select: { id: true, email: true } },
          regression_release: { select: { id: true, version: true } },
        },
      }),
      this.prisma.bug.count({ where }),
    ]);
    return { items, total };
  }

  @Get(':bugId')
  async findOne(
    @Param('projectId') projectId: string,
    @Param('bugId') bugId: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    const bug = await this.prisma.bug.findFirstOrThrow({
      where: { id: bugId, project_id: projectId, ...bugVisibilityWhere(includeArchived === 'true') },
      include: {
        assignee: { select: { id: true, email: true } },
        regression_release: { select: { id: true, version: true } },
        error: {
          include: {
            release: { select: { id: true, version: true } },
            cluster: { select: { id: true, occurrence_count: true } },
          },
        },
      },
    });

    return {
      ...bug,
      regressionDetectedAt: bug.regression_detected_at,
      assignee: bug.assignee ? { id: bug.assignee.id, email: bug.assignee.email } : undefined,
      regressionRelease: bug.regression_release
        ? { id: bug.regression_release.id, version: bug.regression_release.version }
        : undefined,
      release: bug.error.release
        ? { id: bug.error.release.id, version: bug.error.release.version }
        : undefined,
      cluster: bug.error.cluster
        ? { id: bug.error.cluster.id, occurrenceCount: bug.error.cluster.occurrence_count }
        : undefined,
    };
  }

  @Patch(':bugId/status')
  async updateStatus(
    @Param('projectId') projectId: string,
    @Param('bugId') bugId: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser('sub') userId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    const canResolve = await this.authz.canResolveBug(userId, bugId);
    if (!canResolve) {
      throw new ForbiddenException('You do not have permission to change this bug\'s status');
    }
    const bug = await this.prisma.bug.update({
      where: { id: bugId, project_id: projectId },
      data: { status: dto.status },
    });
    await this.audit.log({
      tenantId: tenant.tenantId,
      actorId: userId,
      action: `bug_status_${dto.status}`,
      entityType: 'bug',
      entityId: bugId,
      metadata: { projectId, previousStatus: bug.status },
    });
    this.sse.broadcast(
      { event: 'bug:status_changed', data: { bugId, projectId, status: dto.status } },
      (client) => client.tenantId === tenant.tenantId,
    );
    return bug;
  }

  @Patch(':bugId/assign')
  async assignBug(
    @Param('projectId') projectId: string,
    @Param('bugId') bugId: string,
    @Body() dto: AssignBugDto,
    @CurrentUser('sub') userId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    const canAssign = await this.authz.canAssignBug(userId, bugId);
    if (!canAssign) {
      throw new ForbiddenException('You do not have permission to assign this bug');
    }
    const bug = await this.prisma.bug.update({
      where: { id: bugId, project_id: projectId },
      data: { assigned_to: dto.userId },
      include: { assignee: { select: { id: true, email: true } } },
    });

    await this.audit.log({
      tenantId: tenant.tenantId,
      actorId: userId,
      action: 'bug_assigned',
      entityType: 'bug',
      entityId: bugId,
      metadata: { projectId, assignedTo: dto.userId },
    });
    this.sse.broadcast(
      { event: 'bug:assigned', data: { bugId, projectId, assignedTo: dto.userId } },
      (client) => client.tenantId === tenant.tenantId,
    );

    // Notify the assignee
    await this.prisma.userNotification.create({
      data: {
        user_id: dto.userId,
        project_id: projectId,
        bug_id: bugId,
        type: 'bug_assigned',
        title: `Assigned: ${bug.summary ?? 'Bug'}`,
        body: `You have been assigned to a bug in project ${projectId}.`,
        severity: bug.severity ?? 'medium',
      },
    });

    return {
      ...bug,
      assignee: bug.assignee ? { id: bug.assignee.id, email: bug.assignee.email } : undefined,
    };
  }

  /**
   * Find semantically similar bugs using vector similarity search.
   * Uses the error's embedding vector to find other errors with close vectors,
   * then returns their associated bugs with a similarity distance score.
   */
  @Get(':bugId/similar')
  async findSimilar(
    @Param('projectId') projectId: string,
    @Param('bugId') bugId: string,
    @Query('limit') limit?: string,
  ): Promise<{ similar: SimilarBug[] }> {
    const bug = await this.prisma.bug.findFirst({
      where: { id: bugId, project_id: projectId, ...bugVisibilityWhere(false) },
      include: { error: true },
    });

    if (!bug) {
      return { similar: [] };
    }

    // Fetch the vector via raw query since Prisma doesn't expose Unsupported fields in types
    const vectorRows = await this.prisma.$queryRaw<{ vector: number[] }[]>`
      SELECT vector FROM "Error" WHERE id = ${bug.error.id}::uuid LIMIT 1
    `;

    const vector = vectorRows[0]?.vector;
    if (!vector || vector.length === 0) {
      return { similar: [] };
    }

    const vectorLiteral = JSON.stringify(vector);
    const take = Math.min(parseInt(limit ?? '10', 10) || 10, 50);

    const similar = await this.prisma.$queryRaw<SimilarBug[]>`
      SELECT
        b.id,
        b.summary,
        b.severity,
        b.status,
        b.created_at AS "createdAt",
        (e.vector <=> ${vectorLiteral}::vector) AS distance
      FROM "Error" e
      JOIN "Bug" b ON b.error_id = e.id
      WHERE e.project_id = ${projectId}::uuid
        AND e.id != ${bug.error.id}::uuid
        AND e.vector IS NOT NULL
        AND b.archived_at IS NULL
      ORDER BY e.vector <=> ${vectorLiteral}::vector
      LIMIT ${take}
    `;

    return { similar };
  }

  @Post('bulk-status')
  async bulkUpdateStatus(
    @Param('projectId') projectId: string,
    @Body() dto: { bugIds: string[]; status: string },
    @CurrentUser('sub') userId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    const results = await this.prisma.$transaction(
      dto.bugIds.map((bugId) =>
        this.prisma.bug.update({
          where: { id: bugId, project_id: projectId, archived_at: null },
          data: { status: dto.status },
        }),
      ),
    );
    for (const bugId of dto.bugIds) {
      await this.audit.log({
        tenantId: tenant.tenantId,
        actorId: userId,
        action: `bug_status_${dto.status}`,
        entityType: 'bug',
        entityId: bugId,
        metadata: { projectId, bulk: true },
      });
      this.sse.broadcast(
        { event: 'bug:status_changed', data: { bugId, projectId, status: dto.status } },
        (client) => client.tenantId === tenant.tenantId,
      );
    }
    return { updated: results.length };
  }

  /**
   * Return all bugs that belong to the same cluster as this bug.
   */
  @Get(':bugId/cluster-members')
  async findClusterMembers(
    @Param('projectId') projectId: string,
    @Param('bugId') bugId: string,
  ): Promise<{ members: ClusterMember[] }> {
    const bug = await this.prisma.bug.findFirst({
      where: { id: bugId, project_id: projectId },
      include: { error: { select: { cluster_id: true } } },
    });

    if (!bug?.error.cluster_id) {
      return { members: [] };
    }

    const members = await this.prisma.bug.findMany({
      where: {
        project_id: projectId,
        error: { cluster_id: bug.error.cluster_id },
        id: { not: bugId },
        ...bugVisibilityWhere(false),
      },
      select: {
        id: true,
        summary: true,
        severity: true,
        status: true,
        created_at: true,
        error: { select: { message: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    });

    return {
      members: members.map((m) => ({
        id: m.id,
        summary: m.summary,
        severity: m.severity,
        status: m.status,
        createdAt: m.created_at,
        errorMessage: m.error.message,
      })),
    };
  }

  @Post('archive-old')
  async archiveOld(
    @Param('projectId') projectId: string,
    @Body() dto: ArchiveOldBugsDto,
    @CurrentUser('sub') userId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (!(await this.authz.canManageProject(userId, projectId))) {
      throw new ForbiddenException('You do not have permission to archive bugs in this project');
    }
    const job = await this.archiveQueue.add({
      projectId,
      daysOld: dto.daysOld,
      triggeredBy: userId,
    });
    await this.audit.log({
      tenantId: tenant.tenantId,
      actorId: userId,
      action: 'archive_old_bugs_requested',
      entityType: 'project',
      entityId: projectId,
      metadata: { daysOld: dto.daysOld, jobId: job.id },
    });
    return { jobId: job.id, message: 'Archival job queued' };
  }

  @Post(':bugId/unarchive')
  async unarchive(
    @Param('projectId') projectId: string,
    @Param('bugId') bugId: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (!(await this.authz.canManageProject(userId, projectId))) {
      throw new ForbiddenException('You do not have permission to unarchive bugs in this project');
    }
    const bug = await this.prisma.bug.update({
      where: { id: bugId, project_id: projectId },
      data: { archived_at: null },
    });
    await this.audit.log({
      tenantId: tenant.tenantId,
      actorId: userId,
      action: 'bug_unarchived',
      entityType: 'bug',
      entityId: bugId,
      metadata: { projectId },
    });
    this.sse.broadcast(
      { event: 'bug:unarchived', data: { bugId, projectId } },
      (client) => client.tenantId === tenant.tenantId,
    );
    return bug;
  }
}
