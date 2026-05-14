import { Module } from '@nestjs/common';
import { PipelineTrackerService } from './pipeline-tracker.service';

@Module({
  providers: [PipelineTrackerService],
  exports: [PipelineTrackerService],
})
export class PipelineModule {}
