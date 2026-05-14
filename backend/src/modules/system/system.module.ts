import { Module } from '@nestjs/common';
import { SystemController, DlqController } from './system.controller';
import { RetentionModule } from '../retention/retention.module';
import { PipelineModule } from './pipeline.module';
import { QueueMetricsService } from './queue-metrics.service';
import { ErrorsModule } from '../errors/errors.module';

@Module({
  imports: [RetentionModule, PipelineModule, ErrorsModule],
  controllers: [SystemController, DlqController],
  providers: [QueueMetricsService],
})
export class SystemModule {}
