import { Injectable } from '@nestjs/common';
import type { IntegrationProvider, BugReportPayload, JsonValue, TicketResult } from './integration.interface';

@Injectable()
export class JiraProvider implements IntegrationProvider {
  readonly id = 'jira';
  readonly name = 'Jira';

  async validateCredentials(_config: Record<string, JsonValue>): Promise<boolean> {
    throw new Error('Jira integration not implemented — Phase 2');
  }

  async createTicket(_payload: BugReportPayload, _config: Record<string, JsonValue>): Promise<TicketResult> {
    throw new Error('Jira integration not implemented — Phase 2');
  }
}
