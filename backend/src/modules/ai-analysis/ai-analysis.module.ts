import { Module } from '@nestjs/common';
import { AiAnalysisQueue } from './ai-analysis.queue';
import { AiAnalysisWorker } from './ai-analysis.worker';
import { PromptService } from './prompt.service';
import { ClusteringModule } from '../clustering/clustering.module';
import { RulesModule } from '../rules/rules.module';

@Module({
  imports: [ClusteringModule, RulesModule],
  providers: [AiAnalysisQueue, AiAnalysisWorker, PromptService],
  exports: [AiAnalysisQueue],
})
export class AiAnalysisModule {}
