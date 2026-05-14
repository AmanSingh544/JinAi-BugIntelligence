import { Injectable } from '@nestjs/common';
import { TenantRole } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';

export interface TenantMembership {
  tenantId: string;
  role: TenantRole;
}

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve a user's membership in the tenant that owns a given project.
   * This is the single shared path for tenant resolution.
   */
  async resolveProjectMembership(
    userId: string,
    projectId: string,
  ): Promise<TenantMembership | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { tenant_id: true },
    });
    if (!project) return null;

    const member = await this.prisma.tenantMember.findUnique({
      where: {
        tenant_id_user_id: {
          tenant_id: project.tenant_id,
          user_id: userId,
        },
      },
      select: { tenant_id: true, role: true },
    });

    if (!member) return null;

    return { tenantId: member.tenant_id, role: member.role };
  }

  /**
   * Resolve membership by tenant ID directly (for tenant-scoped routes
   * that don't have a projectId param).
   */
  async resolveTenantMembership(
    userId: string,
    tenantId: string,
  ): Promise<TenantMembership | null> {
    const member = await this.prisma.tenantMember.findUnique({
      where: {
        tenant_id_user_id: {
          tenant_id: tenantId,
          user_id: userId,
        },
      },
      select: { tenant_id: true, role: true },
    });

    if (!member) return null;

    return { tenantId: member.tenant_id, role: member.role };
  }

  // Capability checks — centralize all permission logic here

  async canViewProject(userId: string, projectId: string): Promise<boolean> {
    const m = await this.resolveProjectMembership(userId, projectId);
    return m !== null;
  }

  async canManageProject(userId: string, projectId: string): Promise<boolean> {
    const m = await this.resolveProjectMembership(userId, projectId);
    return m !== null && this.isAtLeast(m.role, TenantRole.admin);
  }

  async canViewBug(userId: string, bugId: string): Promise<boolean> {
    const bug = await this.prisma.bug.findUnique({
      where: { id: bugId },
      select: { project_id: true },
    });
    if (!bug) return false;
    return this.canViewProject(userId, bug.project_id);
  }

  async canAssignBug(userId: string, bugId: string): Promise<boolean> {
    const bug = await this.prisma.bug.findUnique({
      where: { id: bugId },
      select: { project_id: true },
    });
    if (!bug) return false;
    const m = await this.resolveProjectMembership(userId, bug.project_id);
    return m !== null && this.isAtLeast(m.role, TenantRole.developer);
  }

  async canResolveBug(userId: string, bugId: string): Promise<boolean> {
    return this.canAssignBug(userId, bugId);
  }

  async canManageTenant(userId: string, tenantId: string): Promise<boolean> {
    const m = await this.resolveTenantMembership(userId, tenantId);
    return m !== null && this.isAtLeast(m.role, TenantRole.admin);
  }

  async canManageMembers(userId: string, tenantId: string): Promise<boolean> {
    const m = await this.resolveTenantMembership(userId, tenantId);
    return m !== null && this.isAtLeast(m.role, TenantRole.admin);
  }

  async canCreateIntegration(userId: string, projectId: string): Promise<boolean> {
    const m = await this.resolveProjectMembership(userId, projectId);
    return m !== null && this.isAtLeast(m.role, TenantRole.developer);
  }

  async canAccessAiChat(userId: string, bugId: string): Promise<boolean> {
    return this.canViewBug(userId, bugId);
  }

  async canViewAuditLogs(userId: string, tenantId: string): Promise<boolean> {
    const m = await this.resolveTenantMembership(userId, tenantId);
    return m !== null && this.isAtLeast(m.role, TenantRole.admin);
  }

  /**
   * Check if role `a` is at least as privileged as role `b`.
   * Hierarchy: owner > admin > developer > viewer
   */
  private isAtLeast(a: TenantRole, b: TenantRole): boolean {
    const order = [TenantRole.viewer, TenantRole.developer, TenantRole.admin, TenantRole.owner];
    return order.indexOf(a) >= order.indexOf(b);
  }
}
