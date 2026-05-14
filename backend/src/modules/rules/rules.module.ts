import { Module } from '@nestjs/common';
import { RuleEvaluationQueue } from './rule-evaluation.queue';
import { RuleEvaluationWorker } from './rule-evaluation.worker';
import { IntegrationsModule } from '../integrations/integrations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RulesController } from './rules.controller';
import { PipelineModule } from '../system/pipeline.module';

@Module({
  imports: [IntegrationsModule, NotificationsModule, PipelineModule],
  providers: [RuleEvaluationQueue, RuleEvaluationWorker],
  controllers: [RulesController],
  exports: [RuleEvaluationQueue],
})
export class RulesModule {}
