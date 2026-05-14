import { Injectable } from '@nestjs/common';
import type { IntegrationProvider, BugReportPayload, JsonValue, TicketResult } from './integration.interface';
import { externalApiFetch } from '../../../shared/http/external-api-fetch';
import { readJsonResponse } from '../../../shared/http/read-json-response';
import { tokenAuth } from '../../../shared/http/auth-helpers';
import { GITHUB_SCHEMA } from './provider.schema';

@Injectable()
export class GitHubProvider implements IntegrationProvider {
  readonly id = 'github';
  readonly name = 'GitHub Issues';
  readonly schema = GITHUB_SCHEMA;

  async validateCredentials(config: Record<string, JsonValue>): Promise<boolean> {
    const token = config.token as string;
    if (!token) return false;

    try {
      await externalApiFetch(this.id, {
        url: 'https://api.github.com/user',
        headers: { ...tokenAuth('token', token), Accept: 'application/vnd.github+json' },
      });
      return true;
    } catch {
      return false;
    }
  }

  async createTicket(payload: BugReportPayload, config: Record<string, JsonValue>): Promise<TicketResult> {
    const owner = config.owner as string;
    const repo = config.repo as string;
    const token = config.token as string;

    const severityLabels: Record<string, string> = {
      low: 'bug-low',
      medium: 'bug-medium',
      high: 'bug-high',
      critical: 'bug-critical',
    };

    const bodyMd = [
      `## Root Cause`,
      payload.rootCause,
      ``,
      `## Steps to Reproduce`,
      ...payload.stepsToReproduce.map((s) => `- ${s}`),
      ``,
      `## Fix Suggestion`,
      payload.fixSuggestion,
      ``,
      `## Stack Trace`,
      '```',
      payload.stackTrace ?? 'No stack trace',
      '```',
      ``,
      `---`,
      `*Reported by Bug Intelligence Platform*`,
    ].join('\n');

    const res = await externalApiFetch(this.id, {
      url: `https://api.github.com/repos/${owner}/${repo}/issues`,
      method: 'POST',
      headers: {
        ...tokenAuth('token', token),
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
      },
      body: JSON.stringify({
        title: payload.summary,
        body: bodyMd,
        labels: ['bug', severityLabels[payload.severity] ?? 'bug'],
      }),
    });

    const data = await readJsonResponse<{ number: number; html_url: string }>(this.id, res);
    return {
      ticketId: String(data.number),
      url: data.html_url,
    };
  }
}
