import { Module } from '@nestjs/common';
import { RuleEvaluationQueue } from './rule-evaluation.queue';
import { RuleEvaluationWorker } from './rule-evaluation.worker';
import { IntegrationsModule } from '../integrations/integrations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RulesController } from './rules.controller';
import { PipelineModule } from '../system/pipeline.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [IntegrationsModule, NotificationsModule, PipelineModule, AuditModule],
  providers: [RuleEvaluationQueue, RuleEvaluationWorker],
  controllers: [RulesController],
  exports: [RuleEvaluationQueue],
})
export class RulesModule {}
