import { Module } from '@nestjs/common';
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
  ],
})
export class AppModule {}
