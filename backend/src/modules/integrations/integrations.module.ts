import { Module } from '@nestjs/common';
import { DispatchQueue } from './dispatch.queue';
import { DispatchWorker } from './dispatch.worker';
import { IntegrationRegistry } from './providers/integration.registry';
import { MeridianProvider } from './providers/meridian-3sc.provider';
import { JiraProvider } from './providers/jira.provider';
import { GitHubProvider } from './providers/github.provider';
import { GenericHttpProvider } from './providers/generic-http.provider';
import { IntegrationsController, IntegrationProvidersController } from './integrations.controller';
import { PipelineModule } from '../system/pipeline.module';

@Module({
  imports: [PipelineModule],
  providers: [
    DispatchQueue,
    DispatchWorker,
    IntegrationRegistry,
    MeridianProvider,
    JiraProvider,
    GitHubProvider,
    GenericHttpProvider,
  ],
  controllers: [IntegrationsController, IntegrationProvidersController],
  exports: [DispatchQueue, IntegrationRegistry],
})
export class IntegrationsModule {}
