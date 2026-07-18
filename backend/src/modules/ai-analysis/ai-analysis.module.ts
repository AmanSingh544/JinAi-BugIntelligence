import { Module } from '@nestjs/common';
import { AiAnalysisQueue } from './ai-analysis.queue';
import { AiAnalysisWorker } from './ai-analysis.worker';
import { EmbeddingQueue } from './embedding.queue';
import { EmbeddingWorker } from './embedding.worker';
import { PromptService } from './prompt.service';
import { RulesModule } from '../rules/rules.module';
import { PipelineModule } from '../system/pipeline.module';
import { UserNotificationsModule } from '../user-notifications/user-notifications.module';
import { EventsModule } from '../events/events.module';
import { ClusteringModule } from '../clustering/clustering.module';

@Module({
  imports: [RulesModule, PipelineModule, UserNotificationsModule, EventsModule, ClusteringModule],
  providers: [AiAnalysisQueue, AiAnalysisWorker, EmbeddingQueue, EmbeddingWorker, PromptService],
  exports: [AiAnalysisQueue, EmbeddingQueue],
})
export class AiAnalysisModule {}
