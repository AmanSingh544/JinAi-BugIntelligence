import { Test } from '@nestjs/testing';
import { AuthorizationService } from './authorization.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { TenantRole } from '@prisma/client';

const mockPrisma = () => ({
  project: {
    findUnique: jest.fn(),
  },
  tenantMember: {
    findUnique: jest.fn(),
  },
  bug: {
    findUnique: jest.fn(),
  },
});

describe('AuthorizationService', () => {
  let service: AuthorizationService;
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AuthorizationService,
        { provide: PrismaService, useFactory: mockPrisma },
      ],
    }).compile();

    service = module.get(AuthorizationService);
    prisma = module.get(PrismaService);
  });

  describe('resolveProjectMembership', () => {
    it('returns membership when user belongs to project tenant', async () => {
      prisma.project.findUnique.mockResolvedValue({ tenant_id: 't1' });
      prisma.tenantMember.findUnique.mockResolvedValue({ tenant_id: 't1', role: TenantRole.developer });

      const result = await service.resolveProjectMembership('u1', 'p1');
      expect(result).toEqual({ tenantId: 't1', role: TenantRole.developer });
    });

    it('returns null when project does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      const result = await service.resolveProjectMembership('u1', 'p1');
      expect(result).toBeNull();
    });

    it('returns null when user is not a tenant member', async () => {
      prisma.project.findUnique.mockResolvedValue({ tenant_id: 't1' });
      prisma.tenantMember.findUnique.mockResolvedValue(null);
      const result = await service.resolveProjectMembership('u1', 'p1');
      expect(result).toBeNull();
    });
  });

  describe('canViewProject', () => {
    it('allows any tenant member to view', async () => {
      prisma.project.findUnique.mockResolvedValue({ tenant_id: 't1' });
      prisma.tenantMember.findUnique.mockResolvedValue({ tenant_id: 't1', role: TenantRole.viewer });
      expect(await service.canViewProject('u1', 'p1')).toBe(true);
    });
  });

  describe('canManageProject', () => {
    it('allows admin and owner', async () => {
      prisma.project.findUnique.mockResolvedValue({ tenant_id: 't1' });
      prisma.tenantMember.findUnique.mockResolvedValue({ tenant_id: 't1', role: TenantRole.admin });
      expect(await service.canManageProject('u1', 'p1')).toBe(true);
    });

    it('denies viewer', async () => {
      prisma.project.findUnique.mockResolvedValue({ tenant_id: 't1' });
      prisma.tenantMember.findUnique.mockResolvedValue({ tenant_id: 't1', role: TenantRole.viewer });
      expect(await service.canManageProject('u1', 'p1')).toBe(false);
    });
  });

  describe('canAssignBug', () => {
    it('allows developer+', async () => {
      prisma.bug.findUnique.mockResolvedValue({ project_id: 'p1' });
      prisma.project.findUnique.mockResolvedValue({ tenant_id: 't1' });
      prisma.tenantMember.findUnique.mockResolvedValue({ tenant_id: 't1', role: TenantRole.developer });
      expect(await service.canAssignBug('u1', 'b1')).toBe(true);
    });

    it('denies viewer', async () => {
      prisma.bug.findUnique.mockResolvedValue({ project_id: 'p1' });
      prisma.project.findUnique.mockResolvedValue({ tenant_id: 't1' });
      prisma.tenantMember.findUnique.mockResolvedValue({ tenant_id: 't1', role: TenantRole.viewer });
      expect(await service.canAssignBug('u1', 'b1')).toBe(false);
    });
  });
});
