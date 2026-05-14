import { Injectable, Logger } from '@nestjs/common';
import type { IntegrationProvider, BugReportPayload, JsonValue, TicketResult } from './integration.interface';
import { ProviderError } from './provider-error';
import { renderTemplate, renderJsonTemplate, getPath } from '../../../shared/template/template-engine';
import { externalApiFetch } from '../../../shared/http/external-api-fetch';
import { readJsonResponse } from '../../../shared/http/read-json-response';
import { GENERIC_HTTP_SCHEMA } from './provider.schema';

@Injectable()
export class GenericHttpProvider implements IntegrationProvider {
  readonly id = 'generic_http';
  readonly name = 'Custom HTTP / Webhook';
  readonly schema = GENERIC_HTTP_SCHEMA;
  private readonly logger = new Logger(GenericHttpProvider.name);

  async validateCredentials(config: Record<string, JsonValue>): Promise<boolean> {
    const cfg = this.normalizeConfig(config);

    if (!cfg.endpoints?.healthCheck) {
      return this.validateStructure(cfg);
    }

    const url = this.buildUrl(cfg.endpoints.healthCheck.url, cfg.baseUrl);
    try {
      await externalApiFetch(this.id, {
        url,
        method: cfg.endpoints.healthCheck.method ?? 'GET',
        headers: this.buildAuthHeaders(cfg),
      });
      return true;
    } catch {
      return false;
    }
  }

  async createTicket(payload: BugReportPayload, config: Record<string, JsonValue>): Promise<TicketResult> {
    const cfg = this.normalizeConfig(config);

    const url = this.buildUrl(cfg.endpoints.createTicket.url, cfg.baseUrl);
    const varCtx = this.buildVarContext(cfg);
    const bugCtx = this.buildBugContext(payload);

    const finalUrl = renderTemplate(url, varCtx, bugCtx);

    const headers: Record<string, string> = {
      ...(cfg.templates?.headers ? this.renderHeaders(cfg.templates.headers, varCtx, bugCtx) : {}),
      ...this.buildAuthHeaders(cfg),
    };

    if (!headers['content-type'] && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const renderedBody = renderJsonTemplate(cfg.templates.body, varCtx, bugCtx);

    const res = await externalApiFetch(this.id, {
      url: finalUrl,
      method: cfg.endpoints.createTicket.method ?? 'POST',
      headers,
      body: JSON.stringify(renderedBody),
    });

    const data = await readJsonResponse<unknown>(this.id, res);

    const ticketId = getPath(data, cfg.responseMapping.ticketIdPath);
    const ticketUrl = cfg.responseMapping.ticketUrlPath ? getPath(data, cfg.responseMapping.ticketUrlPath) : undefined;

    if (ticketId === undefined || ticketId === null || ticketId === '') {
      throw new ProviderError({ providerId: this.id, message: `Ticket ID not found at path: ${cfg.responseMapping.ticketIdPath}`, statusCode: 0 });
    }

    return {
      ticketId: String(ticketId),
      url: ticketUrl !== undefined && ticketUrl !== null ? String(ticketUrl) : finalUrl,
    };
  }

  async updateTicket(
    ticketId: string,
    _payload: Partial<BugReportPayload>,
    _config: Record<string, JsonValue>,
  ): Promise<void> {
    this.logger.warn(`updateTicket not implemented for generic_http (ticket ${ticketId})`);
  }

  // ─── Helpers ───

  private normalizeConfig(raw: Record<string, JsonValue>): GenericHttpConfig {
    return raw as unknown as GenericHttpConfig;
  }

  private validateStructure(cfg: GenericHttpConfig): boolean {
    return !!(
      cfg.baseUrl &&
      cfg.endpoints?.createTicket?.url &&
      cfg.endpoints.createTicket.method &&
      cfg.responseMapping?.ticketIdPath &&
      cfg.templates?.body
    );
  }

  private buildUrl(url: string, baseUrl: string): string {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    const base = baseUrl.replace(/\/$/, '');
    const path = url.startsWith('/') ? url : `/${url}`;
    return `${base}${path}`;
  }

  private buildAuthHeaders(cfg: GenericHttpConfig): Record<string, string> {
    const headers: Record<string, string> = {};
    const auth = cfg.auth;

    switch (auth.type) {
      case 'bearer': {
        if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
        break;
      }
      case 'basic': {
        if (auth.username && auth.password) {
          const creds = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
          headers['Authorization'] = `Basic ${creds}`;
        }
        break;
      }
      case 'api_key': {
        if (auth.headerName && auth.apiKey) {
          headers[auth.headerName] = auth.apiKey;
        }
        break;
      }
      case 'cookie': {
        if (auth.cookies && Object.keys(auth.cookies).length > 0) {
          headers['Cookie'] = Object.entries(auth.cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
        }
        break;
      }
      case 'none':
      default:
        break;
    }

    return headers;
  }

  private renderHeaders(
    rawHeaders: Record<string, string>,
    varCtx: Record<string, string>,
    bugCtx: Record<string, string>,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawHeaders)) {
      result[k] = renderTemplate(v, varCtx, bugCtx);
    }
    return result;
  }

  private buildVarContext(cfg: GenericHttpConfig): Record<string, string> {
    const ctx: Record<string, string> = {};
    if (cfg.baseUrl) ctx['baseUrl'] = cfg.baseUrl;
    if (cfg.variables) {
      for (const [k, v] of Object.entries(cfg.variables)) {
        ctx[k] = String(v);
      }
    }
    return ctx;
  }

  private buildBugContext(payload: BugReportPayload): Record<string, string> {
    return {
      bugId: payload.bugId,
      projectId: payload.projectId,
      summary: payload.summary,
      rootCause: payload.rootCause,
      stepsToReproduce: Array.isArray(payload.stepsToReproduce) ? payload.stepsToReproduce.join('\n') : '',
      fixSuggestion: payload.fixSuggestion,
      severity: payload.severity,
      errorMessage: payload.errorMessage,
      stackTrace: payload.stackTrace ?? '',
      sessionUrl: payload.sessionUrl,
      screenshotUrl: payload.screenshotUrl ?? '',
      affectedUrl: payload.affectedUrl,
      browser: payload.browser,
      timestamp: payload.timestamp,
      sessionId: payload.sessionId ?? '',
    };
  }
}

// ─── Config type (kept private to this module) ───

interface GenericHttpConfig {
  schemaVersion: number;
  baseUrl: string;
  auth: {
    type: 'none' | 'bearer' | 'basic' | 'api_key' | 'cookie';
    token?: string;
    username?: string;
    password?: string;
    headerName?: string;
    apiKey?: string;
    cookies?: Record<string, string>;
  };
  endpoints: {
    healthCheck?: {
      url: string;
      method: 'GET';
    };
    createTicket: {
      url: string;
      method: 'POST' | 'PUT' | 'PATCH';
    };
  };
  templates: {
    headers?: Record<string, string>;
    body: unknown;
  };
  responseMapping: {
    ticketIdPath: string;
    ticketUrlPath?: string;
  };
  variables?: Record<string, string>;
}
