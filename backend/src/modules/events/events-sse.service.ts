import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';

export interface SseClient {
  id: string;
  userId: string;
  tenantId: string;
  response: Response;
}

export type SseEvent =
  | { event: 'bug:new'; data: { bugId: string; projectId: string; summary: string } }
  | { event: 'bug:status_changed'; data: { bugId: string; projectId: string; status: string } }
  | { event: 'bug:assigned'; data: { bugId: string; projectId: string; assignedTo: string } }
  | { event: 'bug:unarchived'; data: { bugId: string; projectId: string } }
  | { event: 'notification:new'; data: { userId: string; notificationId: string } }
  | { event: 'bug:fix_pr_opened'; data: { bugId: string; projectId: string; prUrl: string; prNumber: number } }
  | { event: 'ping'; data: { ts: number } };

@Injectable()
export class EventsSseService {
  private readonly logger = new Logger(EventsSseService.name);
  private clients = new Map<string, SseClient>();
  private pingInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.pingInterval = setInterval(() => this.broadcastPing(), 30000);
  }

  onModuleDestroy() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    for (const client of this.clients.values()) {
      client.response.end();
    }
    this.clients.clear();
  }

  subscribe(client: SseClient) {
    this.clients.set(client.id, client);
    this.send(client.id, { event: 'connected', data: { clientId: client.id } });
    this.logger.debug(`SSE client connected: ${client.id} (user=${client.userId})`);
  }

  unsubscribe(clientId: string) {
    this.clients.delete(clientId);
    this.logger.debug(`SSE client disconnected: ${clientId}`);
  }

  broadcast(event: SseEvent, filter?: (client: SseClient) => boolean) {
    for (const client of this.clients.values()) {
      if (filter && !filter(client)) continue;
      this.sendToClient(client, event);
    }
  }

  private send(clientId: string, event: { event: string; data: unknown }) {
    const client = this.clients.get(clientId);
    if (!client) return;
    this.sendToClient(client, event as SseEvent);
  }

  private sendToClient(client: SseClient, event: { event: string; data: unknown }) {
    try {
      client.response.write(`event: ${event.event}\n`);
      client.response.write(`data: ${JSON.stringify(event.data)}\n\n`);
    } catch (err) {
      this.logger.warn(`Failed to send SSE to ${client.id}: ${(err as Error).message}`);
      this.unsubscribe(client.id);
    }
  }

  private broadcastPing() {
    this.broadcast({ event: 'ping', data: { ts: Date.now() } });
  }
}
