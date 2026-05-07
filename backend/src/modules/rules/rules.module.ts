import { Module } from '@nestjs/common';
import { RuleEvaluationQueue } from './rule-evaluation.queue';
import { RuleEvaluationWorker } from './rule-evaluation.worker';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [IntegrationsModule],
  providers: [RuleEvaluationQueue, RuleEvaluationWorker],
  exports: [RuleEvaluationQueue],
})
export class RulesModule {}
