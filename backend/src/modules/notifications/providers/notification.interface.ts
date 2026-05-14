import type { JsonValue as IntegrationJsonValue } from '../../integrations/providers/integration.interface';

export type JsonValue = IntegrationJsonValue;

export interface NotificationProvider {
  readonly id: string;
  readonly name: string;
  validateCredentials(config: Record<string, JsonValue>): Promise<boolean>;
  send(bug: BugNotificationPayload, config: Record<string, JsonValue>): Promise<{ messageId: string }>;
}

export interface BugNotificationPayload {
  bugId: string;
  projectId: string;
  summary: string;
  rootCause: string;
  severity: string;
  errorMessage: string;
  url: string;
}
