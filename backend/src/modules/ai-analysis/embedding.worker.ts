import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job } from 'bullmq';
import OpenAI from 'openai';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { EmbeddingJob, EMBEDDING_QUEUE } from './embedding.queue';
import { MetricsService } from '../../shared/metrics/metrics.service';

@Injectable()
export class EmbeddingWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<EmbeddingJob>;
  private readonly logger = new Logger(EmbeddingWorker.name);
  private readonly ai: OpenAI;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    config: ConfigService,
  ) {
    this.ai = new OpenAI({
      apiKey: config.get<string>('AI_API_KEY') ?? '',
      baseURL: config.get<string>('AI_BASE_URL'),
      defaultHeaders: {
        'HTTP-Referer': 'https://bug-intelligence.local',
        'X-Title': 'Bug Intelligence',
      },
    });
  }

  onModuleInit() {
    this.worker = new Worker<EmbeddingJob>(
      EMBEDDING_QUEUE,
      async (job: Job<EmbeddingJob>) => this.process(job),
      { connection: this.redis, concurrency: 4 },
    );

    this.worker.on('failed', (job, err) =>
      this.logger.error(`Embedding job ${job?.id} failed: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker.close();
  }

  private async process(job: Job<EmbeddingJob>) {
    return this.metrics.wrapJob(EMBEDDING_QUEUE, async () => {
      const { errorId, text } = job.data;
      const start = Date.now();

      const embeddingModel = process.env.AI_EMBEDDING_MODEL;
      if (!embeddingModel) {
        this.logger.debug(`No AI_EMBEDDING_MODEL configured — skipping embedding for error=${errorId}`);
        return;
      }

      try {
        const response = await this.ai.embeddings.create({
          model: embeddingModel,
          input: text.slice(0, 2048),
        });

        const embedding = response.data[0]?.embedding;
        if (!embedding || embedding.length === 0) {
          this.logger.warn(`Empty embedding returned for error=${errorId}`);
          return;
        }

        await this.prisma.$executeRaw`
          UPDATE "Error" SET vector = ${JSON.stringify(embedding)}::vector
          WHERE id = ${errorId}::uuid
        `;

        this.logger.debug(`Embedding generated for error=${errorId} dim=${embedding.length} in ${Date.now() - start}ms`);
      } catch (err) {
        this.logger.error(`Embedding generation failed for error=${errorId}: ${(err as Error).message}`);
        throw err; // Let BullMQ retry
      }
    });
  }
}
