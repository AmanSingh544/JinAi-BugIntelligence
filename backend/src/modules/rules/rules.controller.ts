import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/tenant-auth.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { CurrentTenant } from '../../shared/tenant/current-tenant.decorator';
import type { TenantContext } from '../../shared/tenant/tenant-context';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AuthorizationService } from '../auth/authorization.service';

@ApiTags('rules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantAuthGuard)
@Controller('projects/:projectId/rules')
export class RulesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
  ) {}

  @Get()
  async list(@Param('projectId') projectId: string) {
    return this.prisma.rule.findMany({
      where: { project_id: projectId },
      orderBy: { created_at: 'desc' },
    });
  }

  @Post()
  async create(
    @Param('projectId') projectId: string,
    @Body() body: { name: string; conditions: unknown; action: string; is_active?: boolean },
    @CurrentUser('sub') userId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (!(await this.authz.canManageProject(userId, projectId))) {
      throw new ForbiddenException('You do not have permission to create rules in this project');
    }
    return this.prisma.rule.create({
      data: {
        project_id: projectId,
        name: body.name,
        conditions: body.conditions as object,
        action: body.action,
        is_active: body.is_active ?? true,
      },
    });
  }

  @Get(':id')
  async findOne(@Param('projectId') _projectId: string, @Param('id') id: string) {
    return this.prisma.rule.findUnique({ where: { id } });
  }

  @Patch(':id')
  async update(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: { name?: string; conditions?: unknown; action?: string; is_active?: boolean },
    @CurrentUser('sub') userId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (!(await this.authz.canManageProject(userId, projectId))) {
      throw new ForbiddenException('You do not have permission to update rules in this project');
    }
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.conditions !== undefined) data.conditions = body.conditions as object;
    if (body.action !== undefined) data.action = body.action;
    if (body.is_active !== undefined) data.is_active = body.is_active;

    return this.prisma.rule.update({ where: { id }, data });
  }

  @Delete(':id')
  async remove(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (!(await this.authz.canManageProject(userId, projectId))) {
      throw new ForbiddenException('You do not have permission to delete rules in this project');
    }
    await this.prisma.rule.delete({ where: { id } });
    return { deleted: true };
  }

  @Post(':id/toggle')
  async toggle(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (!(await this.authz.canManageProject(userId, projectId))) {
      throw new ForbiddenException('You do not have permission to toggle rules in this project');
    }
    const rule = await this.prisma.rule.findUnique({ where: { id } });
    if (!rule) return { error: 'Rule not found' };
    return this.prisma.rule.update({
      where: { id },
      data: { is_active: !rule.is_active },
    });
  }
}
