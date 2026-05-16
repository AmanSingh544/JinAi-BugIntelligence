import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/tenant-auth.guard';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { bugVisibilityWhere } from '../../shared/helpers/bug-visibility.helper';

@ApiTags('clusters')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantAuthGuard)
@Controller('projects/:projectId/clusters')
export class ClustersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Param('projectId') projectId: string) {
    const clusters = await this.prisma.errorCluster.findMany({
      where: { project_id: projectId },
      orderBy: { occurrence_count: 'desc' },
      include: {
        bug: { select: { id: true, summary: true, severity: true, status: true } },
      },
    });

    const since = new Date();
    since.setDate(since.getDate() - 30);

    const result = await Promise.all(
      clusters.map(async (c) => {
        const uniqueSessions = await this.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(DISTINCT session_id) as count
          FROM "Error"
          WHERE cluster_id = ${c.id}::uuid
            AND created_at >= ${since}
        `;
        return {
          id: c.id,
          occurrenceCount: c.occurrence_count,
          lastSeenAt: c.last_seen_at,
          createdAt: c.created_at,
          bug: c.bug,
          uniqueSessions: Number(uniqueSessions[0]?.count ?? 0),
        };
      }),
    );

    return { clusters: result };
  }

  @Get(':clusterId')
  async detail(
    @Param('projectId') projectId: string,
    @Param('clusterId') clusterId: string,
    @Query('days') days?: string,
  ) {
    const cluster = await this.prisma.errorCluster.findFirst({
      where: { id: clusterId, project_id: projectId },
      include: {
        bug: { select: { id: true, summary: true, severity: true, status: true } },
      },
    });

    if (!cluster) {
      return { cluster: null, bugs: [], trend: [] };
    }

    const daysCount = days ? parseInt(days, 10) : 30;
    const since = new Date();
    since.setDate(since.getDate() - daysCount);

    const [bugs, trendRows] = await Promise.all([
      this.prisma.bug.findMany({
        where: {
          project_id: projectId,
          error: { cluster_id: clusterId },
          ...bugVisibilityWhere(false),
        },
        orderBy: { created_at: 'desc' },
        take: 100,
        select: {
          id: true,
          summary: true,
          severity: true,
          status: true,
          created_at: true,
          error: { select: { message: true } },
        },
      }),
      this.prisma.$queryRaw<{ date: string; count: bigint }[]>`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM "Error"
        WHERE cluster_id = ${clusterId}::uuid
          AND created_at >= ${since}
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `,
    ]);

    const trend = trendRows.map((r) => ({
      date: r.date,
      count: Number(r.count),
    }));

    return {
      cluster: {
        id: cluster.id,
        occurrenceCount: cluster.occurrence_count,
        lastSeenAt: cluster.last_seen_at,
        createdAt: cluster.created_at,
        bug: cluster.bug,
      },
      bugs: bugs.map((b) => ({
        id: b.id,
        summary: b.summary,
        severity: b.severity,
        status: b.status,
        createdAt: b.created_at,
        errorMessage: b.error.message,
      })),
      trend,
    };
  }
}
