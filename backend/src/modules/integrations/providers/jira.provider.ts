import { Injectable } from '@nestjs/common';
import type { IntegrationProvider, BugReportPayload, JsonValue, TicketResult } from './integration.interface';
import { externalApiFetch } from '../../../shared/http/external-api-fetch';
import { readJsonResponse } from '../../../shared/http/read-json-response';
import { basicAuth } from '../../../shared/http/auth-helpers';
import { JIRA_SCHEMA } from './provider.schema';

@Injectable()
export class JiraProvider implements IntegrationProvider {
  readonly id = 'jira';
  readonly name = 'Jira';
  readonly schema = JIRA_SCHEMA;

  private normalizeDomain(domain: string): string {
    return domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }

  async validateCredentials(config: Record<string, JsonValue>): Promise<boolean> {
    const domain = this.normalizeDomain(config.domain as string);
    const email = config.email as string;
    const apiToken = config.apiToken as string;
    if (!domain || !email || !apiToken) return false;

    try {
      await externalApiFetch(this.id, {
        url: `https://${domain}/rest/api/3/myself`,
        headers: { ...basicAuth(email, apiToken), Accept: 'application/json' },
      });
      return true;
    } catch {
      return false;
    }
  }

  async createTicket(payload: BugReportPayload, config: Record<string, JsonValue>): Promise<TicketResult> {
    const domain = this.normalizeDomain(config.domain as string);
    const email = config.email as string;
    const apiToken = config.apiToken as string;
    const projectKey = config.projectKey as string;

    const priorityMap: Record<string, string> = { low: '4', medium: '3', high: '2', critical: '1' };

    const description = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: payload.rootCause }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Steps to reproduce:' }],
        },
        ...payload.stepsToReproduce.map((step) => ({
          type: 'paragraph',
          content: [{ type: 'text', text: `- ${step}` }],
        })),
        {
          type: 'paragraph',
          content: [{ type: 'text', text: `Fix suggestion: ${payload.fixSuggestion}` }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: `Stack trace:\n${payload.stackTrace ?? 'No stack trace'}` }],
        },
      ],
    };

    const body = {
      fields: {
        project: { key: projectKey },
        summary: payload.summary,
        description,
        issuetype: { name: 'Bug' },
        priority: { id: priorityMap[payload.severity] ?? '3' },
        labels: [`bug-intelligence`, `severity-${payload.severity}`],
        assignee: null,
      },
    };

    const res = await externalApiFetch(this.id, {
      url: `https://${domain}/rest/api/3/issue`,
      method: 'POST',
      headers: {
        ...basicAuth(email, apiToken),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await readJsonResponse<{ key: string; id: string }>(this.id, res);
    return {
      ticketId: data.id,
      url: `https://${domain}/browse/${data.key}`,
    };
  }
}
