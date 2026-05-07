import { Module } from '@nestjs/common';
import { DispatchQueue } from './dispatch.queue';
import { DispatchWorker } from './dispatch.worker';
import { IntegrationRegistry } from './providers/integration.registry';
import { MeridianProvider } from './providers/meridian-3sc.provider';
import { JiraProvider } from './providers/jira.provider';
import { GitHubProvider } from './providers/github.provider';

@Module({
  providers: [
    DispatchQueue,
    DispatchWorker,
    IntegrationRegistry,
    MeridianProvider,
    JiraProvider,
    GitHubProvider,
  ],
  exports: [DispatchQueue, IntegrationRegistry],
})
export class IntegrationsModule {}
