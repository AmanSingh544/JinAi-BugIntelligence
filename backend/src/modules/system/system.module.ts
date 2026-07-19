import { Module } from '@nestjs/common';
import { SystemController, DlqController } from './system.controller';
import { HealthController } from './health.controller';
import { RetentionModule } from '../retention/retention.module';
import { PipelineModule } from './pipeline.module';
import { QueueMetricsService } from './queue-metrics.service';
import { ErrorsModule } from '../errors/errors.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [RetentionModule, PipelineModule, ErrorsModule, IntegrationsModule],
  controllers: [SystemController, DlqController, HealthController],
  providers: [QueueMetricsService],
})
export class SystemModule {}
