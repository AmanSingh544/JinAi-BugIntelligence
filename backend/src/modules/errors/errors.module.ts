import { Module } from '@nestjs/common';
import { ErrorDetectionQueue } from './error-detection.queue';
import { ErrorDetectionWorker } from './error-detection.worker';
import { AiAnalysisModule } from '../ai-analysis/ai-analysis.module';

@Module({
  imports: [AiAnalysisModule],
  providers: [ErrorDetectionQueue, ErrorDetectionWorker],
  exports: [ErrorDetectionQueue],
})
export class ErrorsModule {}
