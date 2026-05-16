import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { TenantsService } from './tenants.service';
import { TenantRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';

class InviteMemberDto {
  email!: string;
  role!: TenantRole;
}

@ApiTags('tenants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tenants/:tenantId')
export class TenantsController {
  constructor(
    private readonly tenantsService: TenantsService,
    private readonly audit: AuditService,
  ) {}

  @Get('members')
  async findMembers(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: { sub: string },
  ) {
    return this.tenantsService.findMembers(tenantId, user.sub);
  }

  @Post('members')
  async inviteMember(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: { sub: string },
    @Body() dto: InviteMemberDto,
  ) {
    const member = await this.tenantsService.inviteMember(tenantId, user.sub, dto.email, dto.role);
    await this.audit.log({
      tenantId: tenantId,
      actorId: user.sub,
      action: 'member_invited',
      entityType: 'tenant_member',
      entityId: member.id,
      metadata: { tenantId, inviteeEmail: dto.email, role: dto.role },
    });
    return member;
  }

  @Delete('members/:userId')
  async removeMember(
    @Param('tenantId') tenantId: string,
    @Param('userId') memberUserId: string,
    @CurrentUser() user: { sub: string },
  ) {
    await this.tenantsService.removeMember(tenantId, user.sub, memberUserId);
    await this.audit.log({
      tenantId: tenantId,
      actorId: user.sub,
      action: 'member_removed',
      entityType: 'tenant_member',
      metadata: { tenantId, removedUserId: memberUserId },
    });
    return { success: true };
  }
}
