import { Injectable } from '@nestjs/common';
import type { IntegrationProvider } from './integration.interface';
import { MeridianProvider } from './meridian-3sc.provider';
import { JiraProvider } from './jira.provider';
import { GitHubProvider } from './github.provider';

@Injectable()
export class IntegrationRegistry {
  private readonly providers: Map<string, IntegrationProvider>;

  constructor(
    meridian: MeridianProvider,
    jira: JiraProvider,
    github: GitHubProvider,
  ) {
    this.providers = new Map<string, IntegrationProvider>([
      [meridian.id, meridian],
      [jira.id, jira],
      [github.id, github],
    ]);
  }

  get(providerId: string): IntegrationProvider {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Unknown integration provider: ${providerId}`);
    return provider;
  }

  list(): IntegrationProvider[] {
    return Array.from(this.providers.values());
  }
}
