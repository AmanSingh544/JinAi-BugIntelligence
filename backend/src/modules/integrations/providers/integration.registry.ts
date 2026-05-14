import { Injectable } from '@nestjs/common';
import type { IntegrationProvider } from './integration.interface';
import type { ProviderSchema } from '../../../shared/provider-schema';
import { MeridianProvider } from './meridian-3sc.provider';
import { JiraProvider } from './jira.provider';
import { GitHubProvider } from './github.provider';
import { GenericHttpProvider } from './generic-http.provider';

@Injectable()
export class IntegrationRegistry {
  private readonly providers: Map<string, IntegrationProvider>;

  constructor(
    meridian: MeridianProvider,
    jira: JiraProvider,
    github: GitHubProvider,
    generic: GenericHttpProvider,
  ) {
    this.providers = new Map<string, IntegrationProvider>([
      [meridian.id, meridian],
      [jira.id, jira],
      [github.id, github],
      [generic.id, generic],
    ]);
  }

  get(providerId: string): IntegrationProvider {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Unknown integration provider: ${providerId}`);
    return provider;
  }

  list(): Array<{ id: string; name: string; type: ProviderSchema['type']; schemaVersion: number; fields: ProviderSchema['fields'] }> {
    return Array.from(this.providers.values()).map((p) => ({
      id: p.id,
      name: p.name,
      type: p.schema?.type ?? 'managed',
      schemaVersion: p.schema?.schemaVersion ?? 1,
      fields: p.schema?.fields ?? [],
    }));
  }
}
