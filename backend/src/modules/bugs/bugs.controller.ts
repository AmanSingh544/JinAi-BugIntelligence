import { Body, Controller, ForbiddenException, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/tenant-auth.guard';
import { AuthorizationService } from '../auth/authorization.service';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { CurrentTenant } from '../../shared/tenant/current-tenant.decorator';
import type { TenantContext } from '../../shared/tenant/tenant-context';
import { PrismaService } from '../../shared/prisma/prisma.service';

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

@ApiTags('bugs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantAuthGuard)
@Controller('projects/:projectId/bugs')
export class BugsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
  ) {}

  @Get()
  async findAll(
    @Param('projectId') projectId: string,
    @CurrentTenant() tenant: TenantContext,
    @Query('severity') severity?: string,
    @Query('status') status?: string,
    @Query('regression') regression?: string,
    @Query('assignedTo') assignedTo?: string,
  ) {
    return this.prisma.bug.findMany({
      where: {
        project_id: projectId,
        ...(severity ? { severity } : {}),
        ...(status ? { status } : {}),
        ...(regression === 'regression' ? { regression_detected_at: { not: null } } : {}),
        ...(assignedTo ? { assigned_to: assignedTo } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: 200,
      include: {
        assignee: { select: { id: true, email: true } },
        regression_release: { select: { id: true, version: true } },
      },
    });
  }

  @Get(':bugId')
  async findOne(@Param('projectId') projectId: string, @Param('bugId') bugId: string) {
    const bug = await this.prisma.bug.findFirstOrThrow({
      where: { id: bugId, project_id: projectId },
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
  ) {
    const canResolve = await this.authz.canResolveBug(userId, bugId);
    if (!canResolve) {
      throw new ForbiddenException('You do not have permission to change this bug\'s status');
    }
    return this.prisma.bug.update({
      where: { id: bugId, project_id: projectId },
      data: { status: dto.status },
    });
  }

  @Patch(':bugId/assign')
  async assignBug(
    @Param('projectId') projectId: string,
    @Param('bugId') bugId: string,
    @Body() dto: AssignBugDto,
    @CurrentUser('sub') userId: string,
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
      where: { id: bugId, project_id: projectId },
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
      ORDER BY e.vector <=> ${vectorLiteral}::vector
      LIMIT ${take}
    `;

    return { similar };
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
}
