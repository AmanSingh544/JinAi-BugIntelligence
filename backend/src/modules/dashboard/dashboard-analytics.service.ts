import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { bugVisibilityWhere } from '../../shared/helpers/bug-visibility.helper';

export interface OverviewStats {
  totalBugs: number;
  openBugs: number;
  regressions: number;
  activeIntegrations: number;
}

export interface SeverityDistribution {
  severity: string;
  count: number;
}

export interface ErrorVolumePoint {
  date: string;
  count: number;
}

export interface TopCluster {
  id: string;
  occurrenceCount: number;
  bugSummary: string | null;
  bugSeverity: string | null;
}

export interface RecentRegression {
  id: string;
  summary: string | null;
  severity: string | null;
  regressionDetectedAt: Date;
  releaseVersion: string | null;
}

@Injectable()
export class DashboardAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(projectId: string): Promise<OverviewStats> {
    const [
      totalBugs,
      openBugs,
      regressions,
      activeIntegrations,
    ] = await Promise.all([
      this.prisma.bug.count({ where: { project_id: projectId, ...bugVisibilityWhere(false) } }),
      this.prisma.bug.count({ where: { project_id: projectId, status: 'open', ...bugVisibilityWhere(false) } }),
      this.prisma.bug.count({ where: { project_id: projectId, regression_detected_at: { not: null }, ...bugVisibilityWhere(false) } }),
      this.prisma.projectIntegration.count({ where: { project_id: projectId, is_active: true } }),
    ]);

    return { totalBugs, openBugs, regressions, activeIntegrations };
  }

  async getSeverityDistribution(projectId: string): Promise<SeverityDistribution[]> {
    const rows = await this.prisma.bug.groupBy({
      by: ['severity'],
      where: { project_id: projectId, ...bugVisibilityWhere(false) },
      _count: { id: true },
    });

    return rows.map((r) => ({
      severity: r.severity ?? 'unknown',
      count: r._count.id,
    }));
  }

  async getErrorVolume(projectId: string, days = 7): Promise<ErrorVolumePoint[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    const errors = await this.prisma.error.findMany({
      where: {
        project_id: projectId,
        created_at: { gte: since },
      },
      select: { created_at: true },
      orderBy: { created_at: 'asc' },
    });

    const counts = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      counts.set(d.toISOString().slice(0, 10), 0);
    }

    for (const e of errors) {
      const key = e.created_at.toISOString().slice(0, 10);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return Array.from(counts.entries()).map(([date, count]) => ({ date, count }));
  }

  async getTopClusters(projectId: string, limit = 5): Promise<TopCluster[]> {
    const clusters = await this.prisma.errorCluster.findMany({
      where: { project_id: projectId },
      orderBy: { occurrence_count: 'desc' },
      take: limit,
      select: {
        id: true,
        occurrence_count: true,
        bug: { select: { summary: true, severity: true } },
      },
    });

    return clusters.map((c) => ({
      id: c.id,
      occurrenceCount: c.occurrence_count,
      bugSummary: c.bug?.summary ?? null,
      bugSeverity: c.bug?.severity ?? null,
    }));
  }

  async getRecentRegressions(projectId: string, limit = 5): Promise<RecentRegression[]> {
    return this.prisma.bug.findMany({
      where: {
        project_id: projectId,
        regression_detected_at: { not: null },
        ...bugVisibilityWhere(false),
      },
      orderBy: { regression_detected_at: 'desc' },
      take: limit,
      select: {
        id: true,
        summary: true,
        severity: true,
        regression_detected_at: true,
        regression_release: { select: { version: true } },
      },
    }).then((rows) =>
      rows.map((r) => ({
        id: r.id,
        summary: r.summary,
        severity: r.severity,
        regressionDetectedAt: r.regression_detected_at!,
        releaseVersion: r.regression_release?.version ?? null,
      })),
    );
  }

  async getFingerprintStability(projectId: string): Promise<{ stabilityScore: number; totalErrors: number; matchedErrors: number }> {
    const since = new Date();
    since.setDate(since.getDate() - 7);

    const [totalErrors, matchedErrors] = await Promise.all([
      this.prisma.error.count({
        where: { project_id: projectId, created_at: { gte: since } },
      }),
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count
        FROM "Error" e
        WHERE e.project_id = ${projectId}::uuid
          AND e.created_at >= ${since}
          AND EXISTS (
            SELECT 1 FROM "Error" e2
            WHERE e2.project_id = e.project_id
              AND e2.fingerprint = e.fingerprint
              AND e2.created_at < ${since}
          )
      `,
    ]);

    const matched = Number(matchedErrors[0]?.count ?? 0);
    const score = totalErrors > 0 ? Math.round((matched / totalErrors) * 1000) / 10 : 0;
    return { stabilityScore: score, totalErrors, matchedErrors: matched };
  }

  async getDuplicateBugRate(projectId: string): Promise<{ duplicateRate: number; totalBugs: number; duplicateBugs: number }> {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const totalBugs = await this.prisma.bug.count({
      where: { project_id: projectId, created_at: { gte: since }, ...bugVisibilityWhere(false) },
    });

    const duplicateBugs = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count
      FROM "Bug" b
      JOIN "Error" e ON e.id = b.error_id
      WHERE b.project_id = ${projectId}::uuid
        AND b.created_at >= ${since}
        AND b.archived_at IS NULL
        AND EXISTS (
          SELECT 1 FROM "Bug" b2
          JOIN "Error" e2 ON e2.id = b2.error_id
          WHERE b2.project_id = b.project_id
            AND b2.archived_at IS NULL
            AND e2.fingerprint = e.fingerprint
            AND b2.created_at < ${since}
        )
    `;

    const dupes = Number(duplicateBugs[0]?.count ?? 0);
    const rate = totalBugs > 0 ? Math.round((dupes / totalBugs) * 1000) / 10 : 0;
    return { duplicateRate: rate, totalBugs, duplicateBugs: dupes };
  }
}
