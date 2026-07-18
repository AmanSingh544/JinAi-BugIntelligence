import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { EmbeddingWorker } from './embedding.worker';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { MetricsService } from '../../shared/metrics/metrics.service';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import { ClusteringQueue } from '../clustering/clustering.queue';

const mockPrisma = () => ({
  $executeRaw: jest.fn(),
  error: {
    findUnique: jest.fn().mockResolvedValue({ project_id: 'p1' }),
  },
  embeddingFailure: {
    create: jest.fn(),
  },
});

const mockClusteringQueue = () => ({
  add: jest.fn(),
});

const mockMetrics = () => ({
  wrapJob: jest.fn((_, fn) => fn()),
  registerQueue: jest.fn(),
});

const mockConfig = () => ({
  get: jest.fn().mockImplementation((key: string) => {
    if (key === 'AI_API_KEY') return 'test-key';
    if (key === 'AI_BASE_URL') return undefined;
    return undefined;
  }),
});

const mockRedis = () => ({
  // minimal redis mock
});

describe('EmbeddingWorker', () => {
  let worker: EmbeddingWorker;
  let prisma: ReturnType<typeof mockPrisma>;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    originalEnv = process.env.AI_EMBEDDING_MODEL;
    process.env.AI_EMBEDDING_MODEL = 'text-embedding-3-small';

    const module = await Test.createTestingModule({
      providers: [
        EmbeddingWorker,
        { provide: PrismaService, useFactory: mockPrisma },
        { provide: MetricsService, useFactory: mockMetrics },
        { provide: ConfigService, useFactory: mockConfig },
        { provide: REDIS_CLIENT, useFactory: mockRedis },
        { provide: ClusteringQueue, useFactory: mockClusteringQueue },
      ],
    }).compile();

    worker = module.get(EmbeddingWorker);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    process.env.AI_EMBEDDING_MODEL = originalEnv;
  });

  function createJob(data: { errorId: string; text: string }): Job<any> {
    return { data, id: 'job-1', opts: { attempts: 3 } } as any;
  }

  describe('process', () => {
    it('skips when AI_EMBEDDING_MODEL is not configured', async () => {
      delete process.env.AI_EMBEDDING_MODEL;
      const job = createJob({ errorId: 'e1', text: 'some error message' });

      await (worker as any).process(job);

      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('skips text shorter than 10 characters', async () => {
      const job = createJob({ errorId: 'e1', text: 'short' });

      await (worker as any).process(job);

      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('generates embedding and stores vector', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3];
      const mockCreate = jest.fn().mockResolvedValue({ data: [{ embedding: mockEmbedding }] });
      (worker as any).ai = { embeddings: { create: mockCreate } };

      const job = createJob({ errorId: 'e1', text: 'This is a meaningful error message with enough length' });
      await (worker as any).process(job);

      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        model: 'text-embedding-3-small',
        input: expect.stringContaining('meaningful error'),
      }));
      expect(prisma.$executeRaw).toHaveBeenCalled();
      expect((worker as any).clusteringQueue.add).toHaveBeenCalledWith({
        projectId: 'p1',
        errorId: 'e1',
        vector: mockEmbedding,
      });
    });

    it('handles empty embedding response gracefully', async () => {
      const mockCreate = jest.fn().mockResolvedValue({ data: [{ embedding: [] }] });
      (worker as any).ai = { embeddings: { create: mockCreate } };

      const job = createJob({ errorId: 'e1', text: 'This is a meaningful error message with enough length' });
      await (worker as any).process(job);

      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('throws on OpenAI error to trigger BullMQ retry', async () => {
      const mockCreate = jest.fn().mockRejectedValue(new Error('Rate limited'));
      (worker as any).ai = { embeddings: { create: mockCreate } };

      const job = createJob({ errorId: 'e1', text: 'This is a meaningful error message with enough length' });

      await expect((worker as any).process(job)).rejects.toThrow('Rate limited');
    });

    it('truncates text to 2048 characters', async () => {
      const mockCreate = jest.fn().mockResolvedValue({ data: [{ embedding: [0.1] }] });
      (worker as any).ai = { embeddings: { create: mockCreate } };

      const longText = 'x'.repeat(3000);
      const job = createJob({ errorId: 'e1', text: longText });
      await (worker as any).process(job);

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.input.length).toBe(2048);
    });
  });

  describe('writeToDlq', () => {
    it('writes failure record to database', async () => {
      prisma.embeddingFailure.create.mockResolvedValue({});

      await (worker as any).writeToDlq(
        { errorId: 'e1', text: 'error text' },
        new Error('OpenAI failed'),
        3,
      );

      expect(prisma.embeddingFailure.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          error_id: 'e1',
          text: 'error text',
          error: 'OpenAI failed',
          attempts: 3,
        }),
      });
    });

    it('truncates text and error message', async () => {
      prisma.embeddingFailure.create.mockResolvedValue({});

      const longText = 'x'.repeat(3000);
      const longError = 'y'.repeat(600);
      await (worker as any).writeToDlq(
        { errorId: 'e1', text: longText },
        new Error(longError),
        3,
      );

      const call = prisma.embeddingFailure.create.mock.calls[0][0];
      expect(call.data.text.length).toBeLessThanOrEqual(2048);
      expect(call.data.error.length).toBeLessThanOrEqual(500);
    });

    it('does not throw on database error', async () => {
      prisma.embeddingFailure.create.mockRejectedValue(new Error('DB down'));

      await expect(
        (worker as any).writeToDlq({ errorId: 'e1', text: 'text' }, new Error('fail'), 3),
      ).resolves.not.toThrow();
    });
  });
});
