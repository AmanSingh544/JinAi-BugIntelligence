import { Injectable, Logger } from '@nestjs/common';
import type { IntegrationProvider, BugReportPayload, JsonValue, TicketResult } from './integration.interface';

@Injectable()
export class MeridianProvider implements IntegrationProvider {
  readonly id = 'meridian_3sc';
  readonly name = '3SC Meridian';
  private readonly logger = new Logger(MeridianProvider.name);

  async validateCredentials(config: Record<string, JsonValue>): Promise<boolean> {
    const { baseUrl, apiKey } = config as { baseUrl?: string; apiKey?: string };
    if (!baseUrl || !apiKey) return false;

    try {
      const res = await fetch(`${baseUrl}/api/v1/health`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async createTicket(payload: BugReportPayload, config: Record<string, JsonValue>): Promise<TicketResult> {
    const { baseUrl, apiKey, projectKey } = config as {
      baseUrl: string;
      apiKey: string;
      projectKey?: string;
    };

    const body = {
      title: `[Bug Intelligence] ${payload.summary}`,
      description: this.buildDescription(payload),
      priority: this.mapSeverity(payload.severity),
      labels: ['bug-intelligence', 'auto-detected'],
      projectKey: projectKey ?? undefined,
      metadata: {
        bugId: payload.bugId,
        sessionId: payload.sessionId,
        affectedUrl: payload.affectedUrl,
        detectedAt: payload.timestamp,
      },
    };

    const res = await fetch(`${baseUrl}/api/v1/tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Meridian API ${res.status}: ${text}`);
    }

    const data = await res.json() as { id: string; url: string };
    this.logger.log(`Created Meridian ticket ${data.id} for bug ${payload.bugId}`);
    return { ticketId: data.id, url: data.url };
  }

  async updateTicket(
    ticketId: string,
    payload: Partial<BugReportPayload>,
    config: Record<string, JsonValue>,
  ): Promise<void> {
    const { baseUrl, apiKey } = config as { baseUrl: string; apiKey: string };

    await fetch(`${baseUrl}/api/v1/tickets/${ticketId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ status: 'resolved' }),
      signal: AbortSignal.timeout(10000),
    });
  }

  private buildDescription(p: BugReportPayload): string {
    return [
      `## Summary\n${p.summary}`,
      `## Root Cause\n${p.rootCause}`,
      `## Steps to Reproduce\n${p.stepsToReproduce.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
      `## Fix Suggestion\n${p.fixSuggestion}`,
      p.stackTrace ? `## Stack Trace\n\`\`\`\n${p.stackTrace}\n\`\`\`` : '',
      `## Context\n- **URL:** ${p.affectedUrl}\n- **Browser:** ${p.browser}\n- **Session:** ${p.sessionId}\n- **Time:** ${p.timestamp}`,
    ].filter(Boolean).join('\n\n');
  }

  private mapSeverity(s: BugReportPayload['severity']): string {
    return ({ low: 'low', medium: 'medium', high: 'high', critical: 'critical' })[s];
  }
}
