import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './shared/prisma/prisma.module';
import { RedisModule } from './shared/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { IngestModule } from './modules/ingest/ingest.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { EventsModule } from './modules/events/events.module';
import { ErrorsModule } from './modules/errors/errors.module';
import { ClusteringModule } from './modules/clustering/clustering.module';
import { AiAnalysisModule } from './modules/ai-analysis/ai-analysis.module';
import { RulesModule } from './modules/rules/rules.module';
import { BugsModule } from './modules/bugs/bugs.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { EnvironmentsModule } from './modules/environments/environments.module';
import { SdkModule } from './modules/sdk/sdk.module';
import { ReleasesModule } from './modules/releases/releases.module';
import { UploadModule } from './modules/upload/upload.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SystemModule } from './modules/system/system.module';
import { RetentionModule } from './modules/retention/retention.module';
import { UserNotificationsModule } from './modules/user-notifications/user-notifications.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { HttpMetricsMiddleware } from './shared/metrics/http-metrics.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '.env.local'] }),
    PrismaModule,
    RedisModule,
    AuthModule,
    ProjectsModule,
    IngestModule,
    SessionsModule,
    EventsModule,
    ErrorsModule,
    ClusteringModule,
    AiAnalysisModule,
    RulesModule,
    BugsModule,
    IntegrationsModule,
    DashboardModule,
    EnvironmentsModule,
    SdkModule,
    ReleasesModule,
    UploadModule,
    NotificationsModule,
    SystemModule,
    RetentionModule,
    UserNotificationsModule,
    MetricsModule,
  ],
  providers: [],
  exports: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HttpMetricsMiddleware).forRoutes('*');
  }
}
