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
import { AuditService } from '../audit/audit.service';
import { NotificationRegistry } from './providers/notification.registry';
import { NotificationService } from './notification.service';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantAuthGuard)
@Controller('projects/:projectId/channels')
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: NotificationRegistry,
    private readonly notificationService: NotificationService,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Param('projectId') projectId: string) {
    return this.prisma.notificationChannel.findMany({
      where: { project_id: projectId },
      orderBy: { created_at: 'desc' },
    });
  }

  @Post()
  async create(
    @Param('projectId') projectId: string,
    @Body() body: { provider_id: string; name: string; config: Record<string, unknown>; is_active?: boolean },
    @CurrentUser('sub') userId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (!(await this.authz.canManageProject(userId, projectId))) {
      throw new ForbiddenException('You do not have permission to create notification channels in this project');
    }
    const channel = await this.prisma.notificationChannel.create({
      data: {
        project_id: projectId,
        provider_id: body.provider_id,
        name: body.name,
        config: body.config as object,
        is_active: body.is_active ?? true,
      },
    });
    await this.audit.log({
      tenantId: tenant.tenantId,
      actorId: userId,
      action: 'channel_created',
      entityType: 'notification_channel',
      entityId: channel.id,
      metadata: { projectId, providerId: body.provider_id, name: body.name },
    });
    return channel;
  }

  @Delete(':id')
  async remove(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (!(await this.authz.canManageProject(userId, projectId))) {
      throw new ForbiddenException('You do not have permission to delete notification channels in this project');
    }
    await this.prisma.notificationChannel.delete({ where: { id, project_id: projectId } });
    await this.audit.log({
      tenantId: tenant.tenantId,
      actorId: userId,
      action: 'channel_deleted',
      entityType: 'notification_channel',
      entityId: id,
      metadata: { projectId },
    });
    return { deleted: true };
  }

  @Patch(':id')
  async update(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: { name?: string; config?: Record<string, unknown>; is_active?: boolean },
    @CurrentUser('sub') userId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (!(await this.authz.canManageProject(userId, projectId))) {
      throw new ForbiddenException('You do not have permission to update notification channels in this project');
    }
    const updated = await this.prisma.notificationChannel.update({
      where: { id, project_id: projectId },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.config !== undefined && { config: body.config as object }),
        ...(body.is_active !== undefined && { is_active: body.is_active }),
      },
    });
    await this.audit.log({
      tenantId: tenant.tenantId,
      actorId: userId,
      action: 'channel_updated',
      entityType: 'notification_channel',
      entityId: id,
      metadata: { projectId, changes: Object.keys(body) },
    });
    return updated;
  }

  @Post(':id/test')
  async test(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (!(await this.authz.canManageProject(userId, projectId))) {
      throw new ForbiddenException('You do not have permission to test notification channels in this project');
    }
    const channel = await this.prisma.notificationChannel.findUnique({ where: { id, project_id: projectId } });
    if (!channel) return { success: false, error: 'Channel not found' };

    const provider = this.registry.get(channel.provider_id);
    try {
      const valid = await provider.validateCredentials(channel.config as Record<string, unknown> as Record<string, string | number | boolean | null>);
      return { success: valid };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
