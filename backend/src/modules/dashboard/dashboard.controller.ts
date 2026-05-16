import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/tenant-auth.guard';
import { DashboardAnalyticsService } from './dashboard-analytics.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantAuthGuard)
@Controller('projects/:projectId/analytics')
export class DashboardController {
  constructor(private readonly analytics: DashboardAnalyticsService) {}

  @Get('overview')
  overview(@Param('projectId') projectId: string) {
    return this.analytics.getOverview(projectId);
  }

  @Get('severity-distribution')
  severityDistribution(@Param('projectId') projectId: string) {
    return this.analytics.getSeverityDistribution(projectId);
  }

  @Get('error-volume')
  errorVolume(
    @Param('projectId') projectId: string,
    @Query('days') days?: string,
  ) {
    return this.analytics.getErrorVolume(projectId, days ? parseInt(days, 10) : 7);
  }

  @Get('top-clusters')
  topClusters(
    @Param('projectId') projectId: string,
    @Query('limit') limit?: string,
  ) {
    return this.analytics.getTopClusters(projectId, limit ? parseInt(limit, 10) : 5);
  }

  @Get('recent-regressions')
  recentRegressions(
    @Param('projectId') projectId: string,
    @Query('limit') limit?: string,
  ) {
    return this.analytics.getRecentRegressions(projectId, limit ? parseInt(limit, 10) : 5);
  }

  @Get('fingerprint-stability')
  fingerprintStability(@Param('projectId') projectId: string) {
    return this.analytics.getFingerprintStability(projectId);
  }

  @Get('duplicate-bug-rate')
  duplicateBugRate(@Param('projectId') projectId: string) {
    return this.analytics.getDuplicateBugRate(projectId);
  }
}
