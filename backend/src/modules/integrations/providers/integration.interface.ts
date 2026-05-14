import type { ProviderSchema } from '../../../shared/provider-schema';

export type JsonValue =
  | string | number | boolean | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface BugReportPayload {
  bugId: string;
  projectId: string;
  summary: string;
  rootCause: string;
  stepsToReproduce: string[];
  fixSuggestion: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  errorMessage: string;
  stackTrace?: string;
  sessionUrl: string;
  screenshotUrl?: string;
  affectedUrl: string;
  browser: string;
  timestamp: string;
  sessionId: string | null;
}

export interface TicketResult {
  ticketId: string;
  url: string;
}

export interface IntegrationProvider {
  readonly id: string;
  readonly name: string;
  readonly schema?: ProviderSchema;
  validateCredentials(config: Record<string, JsonValue>): Promise<boolean>;
  createTicket(payload: BugReportPayload, config: Record<string, JsonValue>): Promise<TicketResult>;
  updateTicket?(ticketId: string, payload: Partial<BugReportPayload>, config: Record<string, JsonValue>): Promise<void>;
}
