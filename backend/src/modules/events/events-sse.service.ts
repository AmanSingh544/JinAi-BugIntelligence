import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Response } from 'express';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';

export interface SseClient {
  id: string;
  userId: string;
  /** All tenant memberships — a user in multiple tenants receives events for every one. */
  tenantIds: string[];
  response: Response;
}

/**
 * Delivery target for a broadcast. Serializable so events can fan out across
 * backend instances via Redis pub/sub. Omit both fields to reach every client.
 */
export interface SseTarget {
  tenantId?: string;
  userId?: string;
}

export type SseEvent =
  | {
      event: 'bug:new';
      data: { bugId: string; projectId: string; summary: string };
    }
  | {
      event: 'bug:status_changed';
      data: { bugId: string; projectId: string; status: string };
    }
  | {
      event: 'bug:assigned';
      data: { bugId: string; projectId: string; assignedTo: string };
    }
  | { event: 'bug:unarchived'; data: { bugId: string; projectId: string } }
  | {
      event: 'notification:new';
      data: { userId: string; notificationId: string };
    }
  | {
      event: 'bug:fix_pr_opened';
      data: {
        bugId: string;
        projectId: string;
        prUrl: string;
        prNumber: number;
      };
    }
  | { event: 'ping'; data: { ts: number } };

const SSE_CHANNEL = 'sse:events';

@Injectable()
export class EventsSseService implements OnModuleDestroy {
  private readonly logger = new Logger(EventsSseService.name);
  private clients = new Map<string, SseClient>();
  private pingInterval: NodeJS.Timeout | null = null;
  private readonly sub: Redis;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    this.pingInterval = setInterval(
      () => this.deliverLocal({ event: 'ping', data: { ts: Date.now() } }),
      30000,
    );

    // Dedicated connection for subscriber mode — a subscribed ioredis client
    // can't issue regular commands, so the shared client stays untouched.
    this.sub = this.redis.duplicate();
    this.sub.subscribe(SSE_CHANNEL).catch((err: Error) => {
      this.logger.error(`SSE Redis subscribe failed: ${err.message}`);
    });
    this.sub.on('message', (_channel, raw) => {
      try {
        const { event, target } = JSON.parse(raw) as {
          event: SseEvent;
          target?: SseTarget;
        };
        this.deliverLocal(event, target);
      } catch {
        // malformed message — ignore
      }
    });
  }

  onModuleDestroy() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    for (const client of this.clients.values()) {
      client.response.end();
    }
    this.clients.clear();
    void this.sub.quit().catch(() => {});
  }

  subscribe(client: SseClient) {
    this.clients.set(client.id, client);
    this.sendToClient(client, {
      event: 'connected',
      data: { clientId: client.id },
    });
    this.logger.debug(
      `SSE client connected: ${client.id} (user=${client.userId})`,
    );
  }

  unsubscribe(clientId: string) {
    this.clients.delete(clientId);
    this.logger.debug(`SSE client disconnected: ${clientId}`);
  }

  /**
   * Publish an event to every backend instance via Redis; each instance
   * delivers it to its own matching local clients. Falls back to local-only
   * delivery if Redis publish fails, so single-instance setups keep working
   * through a Redis hiccup.
   */
  broadcast(event: SseEvent, target?: SseTarget) {
    this.redis
      .publish(SSE_CHANNEL, JSON.stringify({ event, target }))
      .catch((err: Error) => {
        this.logger.warn(
          `SSE Redis publish failed (${err.message}) — delivering locally only`,
        );
        this.deliverLocal(event, target);
      });
  }

  private deliverLocal(
    event: { event: string; data: unknown },
    target?: SseTarget,
  ) {
    for (const client of this.clients.values()) {
      if (target?.tenantId && !client.tenantIds.includes(target.tenantId))
        continue;
      if (target?.userId && client.userId !== target.userId) continue;
      this.sendToClient(client, event);
    }
  }

  private sendToClient(
    client: SseClient,
    event: { event: string; data: unknown },
  ) {
    try {
      client.response.write(`event: ${event.event}\n`);
      client.response.write(`data: ${JSON.stringify(event.data)}\n\n`);
    } catch (err) {
      this.logger.warn(
        `Failed to send SSE to ${client.id}: ${(err as Error).message}`,
      );
      this.unsubscribe(client.id);
    }
  }
}
