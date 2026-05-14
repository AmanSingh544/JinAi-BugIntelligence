import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { TenantRole } from '@prisma/client';
import { AuthorizationService } from '../auth/authorization.service';

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
  ) {}

  async createDefaultTenantForUser(userId: string, userEmail: string) {
    const tenant = await this.prisma.tenant.create({
      data: {
        name: `${userEmail.split('@')[0]}'s workspace`,
        members: {
          create: {
            user_id: userId,
            role: TenantRole.owner,
          },
        },
      },
    });

    this.logger.log(`Default tenant created id=${tenant.id} for user=${userId}`);
    return tenant;
  }

  async findMembers(tenantId: string, actorId: string) {
    const canManage = await this.authz.canManageMembers(actorId, tenantId);
    if (!canManage) {
      throw new ForbiddenException('You do not have permission to view members');
    }

    return this.prisma.tenantMember.findMany({
      where: { tenant_id: tenantId },
      include: { user: { select: { id: true, email: true } } },
    });
  }

  async inviteMember(
    tenantId: string,
    actorId: string,
    inviteeEmail: string,
    role: TenantRole,
  ) {
    const canManage = await this.authz.canManageMembers(actorId, tenantId);
    if (!canManage) {
      throw new ForbiddenException('You do not have permission to invite members');
    }

    const invitee = await this.prisma.user.findUnique({
      where: { email: inviteeEmail },
      select: { id: true },
    });
    if (!invitee) {
      throw new NotFoundException(`User with email ${inviteeEmail} not found`);
    }

    const existing = await this.prisma.tenantMember.findUnique({
      where: { tenant_id_user_id: { tenant_id: tenantId, user_id: invitee.id } },
    });
    if (existing) {
      throw new ForbiddenException('User is already a member of this tenant');
    }

    return this.prisma.tenantMember.create({
      data: {
        tenant_id: tenantId,
        user_id: invitee.id,
        role,
      },
      include: { user: { select: { id: true, email: true } } },
    });
  }

  async removeMember(tenantId: string, actorId: string, memberUserId: string) {
    const canManage = await this.authz.canManageMembers(actorId, tenantId);
    if (!canManage) {
      throw new ForbiddenException('You do not have permission to remove members');
    }

    // Prevent removing the last owner
    const member = await this.prisma.tenantMember.findUnique({
      where: { tenant_id_user_id: { tenant_id: tenantId, user_id: memberUserId } },
    });
    if (!member) {
      throw new NotFoundException('Member not found');
    }

    if (member.role === TenantRole.owner) {
      const ownerCount = await this.prisma.tenantMember.count({
        where: { tenant_id: tenantId, role: TenantRole.owner },
      });
      if (ownerCount <= 1) {
        throw new ForbiddenException('Cannot remove the last owner of a tenant');
      }
    }

    await this.prisma.tenantMember.delete({
      where: { tenant_id_user_id: { tenant_id: tenantId, user_id: memberUserId } },
    });
  }
}
