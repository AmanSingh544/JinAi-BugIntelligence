import { Body, Controller, ForbiddenException, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/tenant-auth.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { CurrentTenant } from '../../shared/tenant/current-tenant.decorator';
import type { TenantContext } from '../../shared/tenant/tenant-context';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AuthorizationService } from '../auth/authorization.service';

@ApiTags('projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantAuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
  ) {}

  private async resolveTenantId(userId: string): Promise<string> {
    const member = await this.prisma.tenantMember.findFirst({
      where: { user_id: userId },
      select: { tenant_id: true },
      orderBy: { created_at: 'asc' },
    });
    if (!member) throw new ForbiddenException('User has no tenant membership');
    return member.tenant_id;
  }

  @Post()
  async create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateProjectDto,
    @CurrentTenant() tenant?: TenantContext,
  ) {
    const tenantId = tenant?.tenantId ?? await this.resolveTenantId(userId);
    const canManage = await this.authz.canManageTenant(userId, tenantId);
    if (!canManage) {
      throw new ForbiddenException('You do not have permission to create projects in this tenant');
    }
    return this.projects.create(tenantId, dto);
  }

  @Get()
  async findAll(
    @CurrentUser('sub') userId: string,
    @CurrentTenant() tenant?: TenantContext,
  ) {
    const tenantId = tenant?.tenantId ?? await this.resolveTenantId(userId);
    const canView = await this.authz.canManageTenant(userId, tenantId);
    if (!canView) {
      throw new ForbiddenException('You do not have permission to view projects in this tenant');
    }
    return this.projects.findAll(tenantId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentTenant() tenant: TenantContext) {
    return this.projects.findOne(tenant.tenantId, id);
  }

  @Post(':id/rotate-key')
  async rotateKey(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    const canManage = await this.authz.canManageProject(userId, id);
    if (!canManage) {
      throw new ForbiddenException('You do not have permission to rotate the API key for this project');
    }
    return this.projects.rotateApiKey(tenant.tenantId, id);
  }
}
