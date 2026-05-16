import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { BugsController } from './bugs.controller';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AuthorizationService } from '../auth/authorization.service';
import { AuditService } from '../audit/audit.service';
import { EventsSseService } from '../events/events-sse.service';
import { ArchiveQueue } from './archive.queue';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/tenant-auth.guard';

const mockPrisma = () => ({
  bug: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findFirstOrThrow: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  userNotification: {
    create: jest.fn(),
  },
  $queryRaw: jest.fn(),
  $transaction: jest.fn((cb: any) =>
    Array.isArray(cb) ? Promise.all(cb) : cb(mockPrisma()),
  ),
  $executeRaw: jest.fn(),
});

const mockAuthz = () => ({
  canResolveBug: jest.fn(),
  canAssignBug: jest.fn(),
  canManageProject: jest.fn(),
});

const mockAudit = () => ({
  log: jest.fn(),
});

const mockSse = () => ({
  broadcast: jest.fn(),
});

const mockArchiveQueue = () => ({
  add: jest.fn().mockResolvedValue({ id: 'job-1' }),
});

describe('BugsController', () => {
  let controller: BugsController;
  let prisma: ReturnType<typeof mockPrisma>;
  let authz: ReturnType<typeof mockAuthz>;
  let audit: ReturnType<typeof mockAudit>;
  let sse: ReturnType<typeof mockSse>;
  let archiveQueue: ReturnType<typeof mockArchiveQueue>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [BugsController],
      providers: [
        { provide: PrismaService, useFactory: mockPrisma },
        { provide: AuthorizationService, useFactory: mockAuthz },
        { provide: AuditService, useFactory: mockAudit },
        { provide: EventsSseService, useFactory: mockSse },
        { provide: ArchiveQueue, useFactory: mockArchiveQueue },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(TenantAuthGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get(BugsController);
    prisma = module.get(PrismaService);
    authz = module.get(AuthorizationService);
    audit = module.get(AuditService);
    sse = module.get(EventsSseService);
    archiveQueue = module.get(ArchiveQueue);
  });

  describe('findAll', () => {
    it('returns paginated bugs with default filters', async () => {
      prisma.bug.findMany.mockResolvedValue([{ id: 'b1', summary: 'Bug 1' }]);
      prisma.bug.count.mockResolvedValue(1);

      const result = await controller.findAll('p1', 'u1', { tenantId: 't1' } as any, { page: 1, limit: 20 } as any);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(prisma.bug.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ project_id: 'p1' }),
        take: 20,
      }));
    });

    it('applies search filter', async () => {
      prisma.bug.findMany.mockResolvedValue([]);
      prisma.bug.count.mockResolvedValue(0);

      await controller.findAll('p1', 'u1', { tenantId: 't1' } as any, {
        search: 'crash', page: 1, limit: 20,
      } as any);

      expect(prisma.bug.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { summary: { contains: 'crash', mode: 'insensitive' } },
            { error: { message: { contains: 'crash', mode: 'insensitive' } } },
          ],
        }),
      }));
    });

    it('applies severity and status filters', async () => {
      prisma.bug.findMany.mockResolvedValue([]);
      prisma.bug.count.mockResolvedValue(0);

      await controller.findAll('p1', 'u1', { tenantId: 't1' } as any, {
        severities: ['high', 'critical'], statuses: ['open', 'resolved'], page: 1, limit: 20,
      } as any);

      expect(prisma.bug.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          severity: { in: ['high', 'critical'] },
          status: { in: ['open', 'resolved'] },
        }),
      }));
    });

    it('filters by assignedTo=me', async () => {
      prisma.bug.findMany.mockResolvedValue([]);
      prisma.bug.count.mockResolvedValue(0);

      await controller.findAll('p1', 'u1', { tenantId: 't1' } as any, {
        assignedTo: 'me', page: 1, limit: 20,
      } as any);

      expect(prisma.bug.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ assigned_to: 'u1' }),
      }));
    });

    it('filters by hasRegression=true', async () => {
      prisma.bug.findMany.mockResolvedValue([]);
      prisma.bug.count.mockResolvedValue(0);

      await controller.findAll('p1', 'u1', { tenantId: 't1' } as any, {
        hasRegression: 'true', page: 1, limit: 20,
      } as any);

      expect(prisma.bug.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ regression_detected_at: { not: null } }),
      }));
    });
  });

  describe('findOne', () => {
    it('returns bug detail with related data', async () => {
      prisma.bug.findFirstOrThrow.mockResolvedValue({
        id: 'b1',
        summary: 'Bug 1',
        regression_detected_at: new Date(),
        assignee: { id: 'u1', email: 'a@b.com' },
        regression_release: { id: 'r1', version: 'v1' },
        error: {
          release: { id: 'r2', version: 'v2' },
          cluster: { id: 'c1', occurrence_count: 5 },
        },
      });

      const result = await controller.findOne('p1', 'b1');

      expect(result.id).toBe('b1');
      expect(result.assignee?.email).toBe('a@b.com');
      expect(result.regressionRelease?.version).toBe('v1');
      expect(result.cluster?.occurrenceCount).toBe(5);
    });
  });

  describe('updateStatus', () => {
    it('updates status when user has permission', async () => {
      authz.canResolveBug.mockResolvedValue(true);
      prisma.bug.update.mockResolvedValue({ id: 'b1', status: 'resolved' });

      const result = await controller.updateStatus('p1', 'b1', { status: 'resolved' }, 'u1', { tenantId: 't1' } as any);

      expect(result.status).toBe('resolved');
      expect(audit.log).toHaveBeenCalled();
      expect(sse.broadcast).toHaveBeenCalled();
    });

    it('throws ForbiddenException when user lacks permission', async () => {
      authz.canResolveBug.mockResolvedValue(false);

      await expect(controller.updateStatus('p1', 'b1', { status: 'resolved' }, 'u1', { tenantId: 't1' } as any))
        .rejects.toThrow(ForbiddenException);
    });
  });

  describe('assignBug', () => {
    it('assigns bug and creates notification when user has permission', async () => {
      authz.canAssignBug.mockResolvedValue(true);
      prisma.bug.update.mockResolvedValue({
        id: 'b1',
        summary: 'Bug 1',
        assignee: { id: 'u2', email: 'u2@b.com' },
      });
      prisma.userNotification.create.mockResolvedValue({});

      const result = await controller.assignBug('p1', 'b1', { userId: 'u2' }, 'u1', { tenantId: 't1' } as any);

      expect(result.assignee?.id).toBe('u2');
      expect(prisma.userNotification.create).toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalled();
      expect(sse.broadcast).toHaveBeenCalled();
    });

    it('throws ForbiddenException when user lacks permission', async () => {
      authz.canAssignBug.mockResolvedValue(false);

      await expect(controller.assignBug('p1', 'b1', { userId: 'u2' }, 'u1', { tenantId: 't1' } as any))
        .rejects.toThrow(ForbiddenException);
    });
  });

  describe('bulkUpdateStatus', () => {
    it('updates multiple bugs and audits each', async () => {
      prisma.$transaction.mockResolvedValue([{ id: 'b1' }, { id: 'b2' }]);

      const result = await controller.bulkUpdateStatus('p1', { bugIds: ['b1', 'b2'], status: 'ignored' }, 'u1', { tenantId: 't1' } as any);

      expect(result.updated).toBe(2);
      expect(audit.log).toHaveBeenCalledTimes(2);
      expect(sse.broadcast).toHaveBeenCalledTimes(2);
    });
  });

  describe('findClusterMembers', () => {
    it('returns cluster members excluding self', async () => {
      prisma.bug.findFirst.mockResolvedValue({
        id: 'b1',
        error: { cluster_id: 'c1' },
      });
      prisma.bug.findMany.mockResolvedValue([
        { id: 'b2', summary: 'Bug 2', severity: 'high', status: 'open', created_at: new Date(), error: { message: 'Err' } },
      ]);

      const result = await controller.findClusterMembers('p1', 'b1');

      expect(result.members).toHaveLength(1);
      expect(result.members[0].id).toBe('b2');
    });

    it('returns empty when bug has no cluster', async () => {
      prisma.bug.findFirst.mockResolvedValue({
        id: 'b1',
        error: { cluster_id: null },
      });

      const result = await controller.findClusterMembers('p1', 'b1');

      expect(result.members).toHaveLength(0);
    });
  });

  describe('archiveOld', () => {
    it('queues archive job when user can manage project', async () => {
      authz.canManageProject.mockResolvedValue(true);

      const result = await controller.archiveOld('p1', { daysOld: 30 }, 'u1', { tenantId: 't1' } as any);

      expect(result.jobId).toBe('job-1');
      expect(archiveQueue.add).toHaveBeenCalledWith({ projectId: 'p1', daysOld: 30, triggeredBy: 'u1' });
      expect(audit.log).toHaveBeenCalled();
    });

    it('throws ForbiddenException when user cannot manage project', async () => {
      authz.canManageProject.mockResolvedValue(false);

      await expect(controller.archiveOld('p1', { daysOld: 30 }, 'u1', { tenantId: 't1' } as any))
        .rejects.toThrow(ForbiddenException);
    });
  });

  describe('unarchive', () => {
    it('unarchives bug when user can manage project', async () => {
      authz.canManageProject.mockResolvedValue(true);
      prisma.bug.update.mockResolvedValue({ id: 'b1', archived_at: null });

      const result = await controller.unarchive('p1', 'b1', 'u1', { tenantId: 't1' } as any);

      expect(result.archived_at).toBeNull();
      expect(audit.log).toHaveBeenCalled();
      expect(sse.broadcast).toHaveBeenCalled();
    });

    it('throws ForbiddenException when user cannot manage project', async () => {
      authz.canManageProject.mockResolvedValue(false);

      await expect(controller.unarchive('p1', 'b1', 'u1', { tenantId: 't1' } as any))
        .rejects.toThrow(ForbiddenException);
    });
  });
});
