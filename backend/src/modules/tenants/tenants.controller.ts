import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { TenantsService } from './tenants.service';
import { TenantRole } from '@prisma/client';

class InviteMemberDto {
  email!: string;
  role!: TenantRole;
}

@ApiTags('tenants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tenants/:tenantId')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

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
    return this.tenantsService.inviteMember(tenantId, user.sub, dto.email, dto.role);
  }

  @Delete('members/:userId')
  async removeMember(
    @Param('tenantId') tenantId: string,
    @Param('userId') memberUserId: string,
    @CurrentUser() user: { sub: string },
  ) {
    await this.tenantsService.removeMember(tenantId, user.sub, memberUserId);
    return { success: true };
  }
}
