import { Test } from '@nestjs/testing';
import { RetentionService } from './retention.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

const mockPrisma = () => ({
  projectEnvironment: {
    findMany: jest.fn(),
  },
  $executeRaw: jest.fn(),
  $queryRaw: jest.fn(),
});

describe('RetentionService', () => {
  let service: RetentionService;
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        RetentionService,
        { provide: PrismaService, useFactory: mockPrisma },
      ],
    }).compile();

    service = module.get(RetentionService);
    prisma = module.get(PrismaService);
  });

  describe('cleanupEvents (archive before delete)', () => {
    it('archives events before deleting them', async () => {
      prisma.$executeRaw.mockResolvedValue(5);
      prisma.projectEnvironment.findMany.mockResolvedValue([]);

      const result = await (service as any).cleanupEvents('p1', 30);

      expect(result).toBe(5);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it('returns 0 when days is 0 or negative', async () => {
      const result = await (service as any).cleanupEvents('p1', 0);
      expect(result).toBe(0);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('cleanupEventArchives', () => {
    it('deletes archived events after 3x retention period', async () => {
      prisma.$executeRaw.mockResolvedValue(3);

      const result = await (service as any).cleanupEventArchives('p1', 30);

      expect(result).toBe(3);
      // Verify the call was made with 90 days (30 * 3)
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      const callArgs = prisma.$executeRaw.mock.calls[0];
      expect(callArgs[callArgs.length - 1]).toBe(90);
    });

    it('returns 0 when days is 0 or negative', async () => {
      const result = await (service as any).cleanupEventArchives('p1', 0);
      expect(result).toBe(0);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('cleanupReplay', () => {
    it('deletes old replay segments', async () => {
      prisma.$executeRaw.mockResolvedValue(2);

      const result = await (service as any).cleanupReplay('p1', 7);

      expect(result).toBe(2);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('cleanupBugDetails', () => {
    it('nulls out ai_raw_output and replay_url for old bugs', async () => {
      prisma.$executeRaw.mockResolvedValue(4);

      const result = await (service as any).cleanupBugDetails('p1', 30);

      expect(result).toBe(4);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('runCleanup', () => {
    it('processes all environments and logs totals', async () => {
      prisma.projectEnvironment.findMany.mockResolvedValue([
        {
          project_id: 'p1',
          name: 'production',
          retention_replay_days: 7,
          retention_events_days: 30,
          retention_screenshots_days: 14,
          retention_bug_detail_days: 30,
          retention_dlq_days: 14,
          project: { id: 'p1', name: 'Test Project' },
        },
      ]);
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.$queryRaw.mockResolvedValue(0);

      await service.runCleanup();

      expect(prisma.projectEnvironment.findMany).toHaveBeenCalled();
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('handles errors for individual environments gracefully', async () => {
      prisma.projectEnvironment.findMany.mockResolvedValue([
        {
          project_id: 'p1',
          name: 'production',
          retention_replay_days: 7,
          retention_events_days: 30,
          retention_screenshots_days: 14,
          retention_bug_detail_days: 30,
          retention_dlq_days: 14,
          project: { id: 'p1', name: 'Test Project' },
        },
      ]);
      // cleanupReplay succeeds, cleanupEvents fails, rest don't run for that env
      prisma.$executeRaw
        .mockResolvedValueOnce(1)  // cleanupReplay
        .mockRejectedValueOnce(new Error('DB error')); // cleanupEvents
      prisma.$queryRaw.mockResolvedValue([]);

      // Should not throw — per-environment errors are caught
      await expect(service.runCleanup()).resolves.not.toThrow();
    });
  });
});
