import { Injectable } from '@nestjs/common';
import type { IntegrationProvider, BugReportPayload, JsonValue, TicketResult } from './integration.interface';

@Injectable()
export class GitHubProvider implements IntegrationProvider {
  readonly id = 'github';
  readonly name = 'GitHub Issues';

  async validateCredentials(_config: Record<string, JsonValue>): Promise<boolean> {
    throw new Error('GitHub integration not implemented — Phase 2');
  }

  async createTicket(_payload: BugReportPayload, _config: Record<string, JsonValue>): Promise<TicketResult> {
    throw new Error('GitHub integration not implemented — Phase 2');
  }
}
