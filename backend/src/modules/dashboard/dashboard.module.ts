import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardAnalyticsService } from './dashboard-analytics.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardAnalyticsService],
})
export class DashboardModule {}
