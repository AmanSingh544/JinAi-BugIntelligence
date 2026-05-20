import { Injectable, Logger } from '@nestjs/common';
import type { IntegrationProvider, BugReportPayload, JsonValue, TicketResult } from './integration.interface';
import { externalApiFetch } from '../../../shared/http/external-api-fetch';
import { readJsonResponse } from '../../../shared/http/read-json-response';
import { MERIDIAN_SCHEMA } from './provider.schema';

// Auth: the Meridian platform issues a customer_access_token (JWT) per user session.
// For machine-to-machine dispatch we require the user to paste their customer_access_token
// into the integration config. The token is sent as a Bearer header alongside x-portal-type: customer.
// tenant_id is passed as a query param on every request.

@Injectable()
export class MeridianProvider implements IntegrationProvider {
  readonly id = 'meridian_3sc';
  readonly name = '3SC Meridian';
  readonly schema = MERIDIAN_SCHEMA;
  private readonly logger = new Logger(MeridianProvider.name);

  async validateCredentials(config: Record<string, JsonValue>): Promise<boolean> {
    const { baseUrl, accessToken, tenantId } = config as {
      baseUrl?: string;
      accessToken?: string;
      tenantId?: string;
    };
    if (!baseUrl || !accessToken || !tenantId) return false;

    try {
      const res = await externalApiFetch(this.id, {
        url: `${baseUrl}/api/v1/tickets?tenant_id=${encodeURIComponent(tenantId)}&limit=1`,
        headers: this.authHeaders(accessToken),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async createTicket(payload: BugReportPayload, config: Record<string, JsonValue>): Promise<TicketResult> {
    const { baseUrl, accessToken, tenantId, projectId, environment } = config as {
      baseUrl: string;
      accessToken: string;
      tenantId: string;
      projectId?: string;
      environment?: string;
    };

    const body: Record<string, unknown> = {
      title: `[Bug Intelligence] ${payload.summary}`,
      description: this.buildDescription(payload),
      priority: this.mapSeverity(payload.severity),
      category: 'SUPPORT',
      tags: ['bug-intelligence', 'auto-detected', payload.severity],
      attachment_ids: [],
    };

    // Optional fields — only include if configured
    if (projectId) body.projectId = projectId;
    if (environment) body.environment = environment;

    const res = await externalApiFetch(this.id, {
      url: `${baseUrl}/api/v1/tickets?tenant_id=${encodeURIComponent(tenantId)}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders(accessToken),
      },
      body: JSON.stringify(body),
    });

    const data = await readJsonResponse<{ id: string; url?: string }>(this.id, res);
    const ticketUrl = data.url ?? `${baseUrl}/tickets/${data.id}`;
    this.logger.log(`Created Meridian ticket ${data.id} for bug ${payload.bugId}`);
    return { ticketId: data.id, url: ticketUrl };
  }

  async updateTicket(
    ticketId: string,
    _payload: Partial<BugReportPayload>,
    config: Record<string, JsonValue>,
  ): Promise<void> {
    const { baseUrl, accessToken, tenantId } = config as {
      baseUrl: string;
      accessToken: string;
      tenantId: string;
    };

    await externalApiFetch(this.id, {
      url: `${baseUrl}/api/v1/tickets/${ticketId}?tenant_id=${encodeURIComponent(tenantId)}`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders(accessToken),
      },
      body: JSON.stringify({ status: 'RESOLVED' }),
    });
  }

  private authHeaders(accessToken: string): Record<string, string> {
    // Meridian uses HttpOnly cookies for auth — send token as cookie, not Bearer header
    return {
      Cookie: `customer_access_token=${accessToken}`,
      'x-portal-type': 'customer',
    };
  }

  private buildDescription(p: BugReportPayload): string {
    return [
      `## Summary\n${p.summary}`,
      `## Root Cause\n${p.rootCause}`,
      `## Steps to Reproduce\n${p.stepsToReproduce.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
      `## Fix Suggestion\n${p.fixSuggestion}`,
      p.stackTrace ? `## Stack Trace\n\`\`\`\n${p.stackTrace}\n\`\`\`` : '',
      `## Context\n- **URL:** ${p.affectedUrl}\n- **Browser:** ${p.browser}\n- **Session:** ${p.sessionId}\n- **Time:** ${p.timestamp}`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  // Meridian expects uppercase priority strings
  private mapSeverity(s: BugReportPayload['severity']): string {
    return { low: 'LOW', medium: 'MEDIUM', high: 'HIGH', critical: 'CRITICAL' }[s] ?? 'MEDIUM';
  }
}
