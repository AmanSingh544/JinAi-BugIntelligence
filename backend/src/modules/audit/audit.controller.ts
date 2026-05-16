import { Controller, Get, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/tenant-auth.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { AuthorizationService } from '../auth/authorization.service';
import { AuditService } from './audit.service';
import { AuditLogsQueryDto } from './audit-logs-query.dto';

@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantAuthGuard)
@Controller('audit-logs')
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly authz: AuthorizationService,
  ) {}

  @Get()
  async list(
    @CurrentUser('sub') userId: string,
    @Query() query: AuditLogsQueryDto,
  ) {
    const membership = await this.authz.resolveProjectMembership(userId, query.projectId);
    if (!membership) {
      throw new BadRequestException('You do not have access to this project');
    }
    const canView = await this.authz.canViewAuditLogs(userId, membership.tenantId);
    if (!canView) {
      return { error: 'You do not have permission to view audit logs' };
    }
    const skip = (query.page! - 1) * query.limit!;
    const [items, total] = await Promise.all([
      this.audit.findByTenant(membership.tenantId, skip, query.limit),
      this.audit.countByTenant(membership.tenantId),
    ]);
    return { items, total };
  }
}
