import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { Queue } from 'bullmq';

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  readonly registry = new Registry();
  private readonly logger = new Logger(MetricsService.name);
  private queueDepthInterval: ReturnType<typeof setInterval> | null = null;

  // HTTP
  readonly httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [this.registry],
  });

  readonly httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  // BullMQ Workers
  readonly bullmqJobsTotal = new Counter({
    name: 'bullmq_jobs_processed_total',
    help: 'Total BullMQ jobs processed',
    labelNames: ['queue', 'status'],
    registers: [this.registry],
  });

  readonly bullmqJobDuration = new Histogram({
    name: 'bullmq_job_duration_seconds',
    help: 'BullMQ job processing duration in seconds',
    labelNames: ['queue'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
    registers: [this.registry],
  });

  readonly bullmqQueueDepth = new Gauge({
    name: 'bullmq_queue_depth',
    help: 'Current BullMQ queue depth by state',
    labelNames: ['queue', 'state'],
    registers: [this.registry],
  });

  // Providers
  readonly providerErrorsTotal = new Counter({
    name: 'provider_errors_total',
    help: 'Total provider errors by provider and status code',
    labelNames: ['provider', 'status_code'],
    registers: [this.registry],
  });

  readonly providerCooldownActive = new Gauge({
    name: 'provider_cooldown_active',
    help: 'Whether a provider is currently in cooldown (1 = yes, 0 = no)',
    labelNames: ['provider'],
    registers: [this.registry],
  });

  // AI
  readonly aiLlmCallsTotal = new Counter({
    name: 'ai_llm_calls_total',
    help: 'Total AI LLM calls by model and status',
    labelNames: ['model', 'status'],
    registers: [this.registry],
  });

  readonly aiLlmDuration = new Histogram({
    name: 'ai_llm_duration_seconds',
    help: 'AI LLM call duration in seconds',
    labelNames: ['model'],
    buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15, 30, 60, 120],
    registers: [this.registry],
  });

  private queueInstances: Queue[] = [];

  onModuleInit() {
    // Enable default metrics: CPU, memory, event loop lag, GC, etc.
    collectDefaultMetrics({ register: this.registry });
    this.logger.log('Default metrics enabled');

    // Start interval-based queue depth updater (every 15s)
    this.queueDepthInterval = setInterval(() => this.updateQueueDepths(), 15000);
  }

  onModuleDestroy() {
    if (this.queueDepthInterval) {
      clearInterval(this.queueDepthInterval);
    }
  }

  registerQueue(queue: Queue) {
    this.queueInstances.push(queue);
  }

  private async updateQueueDepths() {
    for (const queue of this.queueInstances) {
      try {
        const [waiting, active, delayed, failed] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getDelayedCount(),
          queue.getFailedCount(),
        ]);
        const name = queue.name;
        this.bullmqQueueDepth.set({ queue: name, state: 'waiting' }, waiting);
        this.bullmqQueueDepth.set({ queue: name, state: 'active' }, active);
        this.bullmqQueueDepth.set({ queue: name, state: 'delayed' }, delayed);
        this.bullmqQueueDepth.set({ queue: name, state: 'failed' }, failed);
      } catch (err) {
        this.logger.warn(`Failed to update queue depth for ${queue.name}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Wrap a BullMQ job processor to record metrics automatically.
   * Usage: return await this.metrics.wrapJob('queueName', () => this.processInner(job));
   */
  async wrapJob<T>(queueName: string, fn: () => Promise<T>): Promise<T> {
    const end = this.bullmqJobDuration.startTimer({ queue: queueName });
    try {
      const result = await fn();
      this.bullmqJobsTotal.inc({ queue: queueName, status: 'success' });
      return result;
    } catch (err) {
      this.bullmqJobsTotal.inc({ queue: queueName, status: 'failure' });
      throw err;
    } finally {
      end();
    }
  }
}
