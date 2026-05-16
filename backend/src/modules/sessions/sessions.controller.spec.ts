import { Test } from '@nestjs/testing';
import { SessionsController } from './sessions.controller';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/tenant-auth.guard';

const mockPrisma = () => ({
  session: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  event: {
    findMany: jest.fn(),
  },
  eventArchive: {
    findMany: jest.fn(),
  },
  replaySegment: {
    findMany: jest.fn(),
  },
});

describe('SessionsController', () => {
  let controller: SessionsController;
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [SessionsController],
      providers: [
        { provide: PrismaService, useFactory: mockPrisma },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(TenantAuthGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get(SessionsController);
    prisma = module.get(PrismaService);
  });

  describe('findAll', () => {
    it('returns paginated sessions', async () => {
      prisma.session.findMany.mockResolvedValue([{ id: 's1', project_id: 'p1' }]);
      prisma.session.count.mockResolvedValue(1);

      const result = await controller.findAll('p1', { page: 1, limit: 20 } as any);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('getTimeline', () => {
    it('returns hot events only when sufficient', async () => {
      prisma.session.findFirst.mockResolvedValue({ id: 's1', project_id: 'p1' });
      // Simulate having enough hot events to fill the limit
      const hotEvents = Array.from({ length: 200 }, (_, i) => ({
        id: `e${i}`,
        type: 'click',
        timestamp: BigInt(i * 1000),
        payload: { selector: '#btn' },
      }));
      prisma.event.findMany.mockResolvedValue(hotEvents);
      prisma.eventArchive.findMany.mockResolvedValue([]);

      const result = await controller.getTimeline('p1', 's1');

      expect(result.events).toHaveLength(200);
      expect(prisma.eventArchive.findMany).not.toHaveBeenCalled();
    });

    it('falls back to archive when hot events are fewer than limit', async () => {
      prisma.session.findFirst.mockResolvedValue({ id: 's1', project_id: 'p1' });
      prisma.event.findMany.mockResolvedValue([
        { id: 'e1', type: 'click', timestamp: 1000n, payload: { selector: '#btn' } },
      ]);
      prisma.eventArchive.findMany.mockResolvedValue([
        { id: 'e2', type: 'navigation', timestamp: 500n, payload: { from: '/', to: '/home' } },
      ]);

      const result = await controller.getTimeline('p1', 's1', '10');

      expect(result.events).toHaveLength(2);
      expect(prisma.eventArchive.findMany).toHaveBeenCalledWith(expect.objectContaining({
        take: 9,
      }));
    });

    it('deduplicates events present in both hot and archive', async () => {
      prisma.session.findFirst.mockResolvedValue({ id: 's1', project_id: 'p1' });
      prisma.event.findMany.mockResolvedValue([
        { id: 'e1', type: 'click', timestamp: 1000n, payload: { selector: '#btn' } },
      ]);
      prisma.eventArchive.findMany.mockResolvedValue([
        { id: 'e1', type: 'click', timestamp: 1000n, payload: { selector: '#btn' } },
        { id: 'e2', type: 'error', timestamp: 2000n, payload: { message: 'Oops' } },
      ]);

      const result = await controller.getTimeline('p1', 's1', '10');

      expect(result.events).toHaveLength(2);
    });

    it('caps limit at 500', async () => {
      prisma.session.findFirst.mockResolvedValue({ id: 's1', project_id: 'p1' });
      prisma.event.findMany.mockResolvedValue([]);
      prisma.eventArchive.findMany.mockResolvedValue([]);

      await controller.getTimeline('p1', 's1', '1000');

      expect(prisma.event.findMany).toHaveBeenCalledWith(expect.objectContaining({
        take: 500,
      }));
    });
  });
});
