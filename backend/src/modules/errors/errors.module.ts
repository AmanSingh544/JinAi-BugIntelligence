import { Module } from '@nestjs/common';
import { ErrorDetectionQueue } from './error-detection.queue';
import { ErrorDetectionWorker } from './error-detection.worker';
import { AiAnalysisModule } from '../ai-analysis/ai-analysis.module';
import { PipelineModule } from '../system/pipeline.module';

@Module({
  imports: [AiAnalysisModule, PipelineModule],
  providers: [ErrorDetectionQueue, ErrorDetectionWorker],
  exports: [ErrorDetectionQueue],
})
export class ErrorsModule {}
