import { Test } from '@nestjs/testing';
import { IntegrationRegistry } from './integration.registry';
import { JiraProvider } from './jira.provider';
import { GitHubProvider } from './github.provider';
import { MeridianProvider } from './meridian-3sc.provider';
import { GenericHttpProvider } from './generic-http.provider';

const mockProvider = (id: string, name: string, type = 'managed') => ({
  id,
  name,
  schema: { type, schemaVersion: 1, fields: [] },
});

describe('IntegrationRegistry', () => {
  let registry: IntegrationRegistry;
  let jira: ReturnType<typeof mockProvider>;
  let github: ReturnType<typeof mockProvider>;
  let meridian: ReturnType<typeof mockProvider>;
  let generic: ReturnType<typeof mockProvider>;

  beforeEach(async () => {
    jira = mockProvider('jira', 'Jira') as any;
    github = mockProvider('github', 'GitHub Issues') as any;
    meridian = mockProvider('meridian_3sc', 'Meridian') as any;
    generic = mockProvider('generic_http', 'Custom HTTP', 'generic') as any;

    const module = await Test.createTestingModule({
      providers: [
        IntegrationRegistry,
        { provide: JiraProvider, useValue: jira },
        { provide: GitHubProvider, useValue: github },
        { provide: MeridianProvider, useValue: meridian },
        { provide: GenericHttpProvider, useValue: generic },
      ],
    }).compile();

    registry = module.get(IntegrationRegistry);
  });

  describe('get', () => {
    it('returns provider by id', () => {
      expect(registry.get('jira')).toBe(jira);
      expect(registry.get('github')).toBe(github);
      expect(registry.get('generic_http')).toBe(generic);
    });

    it('throws for unknown provider', () => {
      expect(() => registry.get('unknown')).toThrow('Unknown integration provider: unknown');
    });
  });

  describe('list', () => {
    it('returns all providers with metadata', () => {
      const list = registry.list();
      expect(list).toHaveLength(4);
      expect(list.map((p) => p.id)).toEqual(expect.arrayContaining(['jira', 'github', 'meridian_3sc', 'generic_http']));
    });

    it('includes schema type', () => {
      const list = registry.list();
      const genericEntry = list.find((p) => p.id === 'generic_http');
      expect(genericEntry?.type).toBe('generic');
      const jiraEntry = list.find((p) => p.id === 'jira');
      expect(jiraEntry?.type).toBe('managed');
    });

    it('defaults schemaVersion to 1 when missing', () => {
      const list = registry.list();
      expect(list.every((p) => p.schemaVersion === 1)).toBe(true);
    });
  });
});
