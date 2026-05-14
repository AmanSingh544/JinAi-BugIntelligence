import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';

const SYNTHETIC_PREFIX = 'synthetic:';
const LATENCY_PREFIX = 'pipeline:latency:';
const MAX_LATENCY_ENTRIES = 1000;

export type PipelineStage =
  | 'submitted'
  | 'detection'
  | 'ai_analysis'
  | 'rule_evaluation'
  | 'dispatch'
  | 'completed'
  | 'failed';

export interface SyntheticStatus {
  trackingId: string;
  stages: Record<PipelineStage, number | undefined>;
  currentStage: PipelineStage;
  elapsedMs: number;
  bugId?: string;
  errorId?: string;
}

@Injectable()
export class PipelineTrackerService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async startTracking(trackingId: string): Promise<void> {
    const key = `${SYNTHETIC_PREFIX}${trackingId}`;
    await this.redis.hset(key, {
      stage: 'submitted',
      started_at: Date.now(),
    });
    await this.redis.expire(key, 3600); // 1 hour TTL
  }

  async recordStage(
    trackingId: string | undefined,
    stage: PipelineStage,
    metadata?: { bugId?: string; errorId?: string },
  ): Promise<void> {
    if (!trackingId) return;
    const key = `${SYNTHETIC_PREFIX}${trackingId}`;
    const data: Record<string, string> = {
      [`stage_${stage}`]: String(Date.now()),
      stage,
    };
    if (metadata?.bugId) data.bug_id = metadata.bugId;
    if (metadata?.errorId) data.error_id = metadata.errorId;
    await this.redis.hset(key, data);
  }

  async recordLatency(stage: PipelineStage, latencyMs: number): Promise<void> {
    const key = `${LATENCY_PREFIX}${stage}`;
    await this.redis.zadd(key, Date.now(), `${Date.now()}:${latencyMs}`);
    // Trim to last 1000 entries
    const count = await this.redis.zcard(key);
    if (count > MAX_LATENCY_ENTRIES) {
      await this.redis.zremrangebyrank(key, 0, count - MAX_LATENCY_ENTRIES - 1);
    }
    await this.redis.expire(key, 86400 * 7); // 7 days
  }

  async getSyntheticStatus(trackingId: string): Promise<SyntheticStatus | null> {
    const key = `${SYNTHETIC_PREFIX}${trackingId}`;
    const data = await this.redis.hgetall(key);
    if (!data || Object.keys(data).length === 0) return null;

    const startedAt = parseInt(data.started_at ?? '0', 10);
    const stages: Record<string, number | undefined> = {};
    for (const [k, v] of Object.entries(data)) {
      if (k.startsWith('stage_')) {
        stages[k.replace('stage_', '')] = parseInt(v, 10);
      }
    }

    return {
      trackingId,
      stages: stages as Record<PipelineStage, number | undefined>,
      currentStage: (data.stage as PipelineStage) ?? 'submitted',
      elapsedMs: Date.now() - startedAt,
      bugId: data.bug_id,
      errorId: data.error_id,
    };
  }

  async getLatencyStats(stage: PipelineStage): Promise<{ count: number; avgMs: number; p95Ms: number }> {
    const key = `${LATENCY_PREFIX}${stage}`;
    const entries = await this.redis.zrange(key, 0, -1);
    if (entries.length === 0) return { count: 0, avgMs: 0, p95Ms: 0 };

    const latencies = entries
      .map((e) => parseInt(e.split(':')[1], 10))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);

    const avgMs = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    const p95Index = Math.floor(latencies.length * 0.95);
    const p95Ms = latencies[Math.min(p95Index, latencies.length - 1)];

    return { count: latencies.length, avgMs, p95Ms };
  }
}
