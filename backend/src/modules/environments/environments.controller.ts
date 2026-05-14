import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/tenant-auth.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { CurrentTenant } from '../../shared/tenant/current-tenant.decorator';
import type { TenantContext } from '../../shared/tenant/tenant-context';
import { AuthorizationService } from '../auth/authorization.service';
import { EnvironmentService } from './environment.service';
import { UpdateEnvironmentDto } from './dto/update-environment.dto';

@ApiTags('environments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantAuthGuard)
@Controller('projects/:projectId/environments')
export class EnvironmentsController {
  constructor(
    private readonly envService: EnvironmentService,
    private readonly authz: AuthorizationService,
  ) {}

  @Get()
  findAll(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
  ) {
    // Ownership check is delegated to Prisma implicit filter or service layer
    return this.envService.findByProject(projectId);
  }

  @Get(':id')
  findOne(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ) {
    return this.envService.findOne(projectId, id);
  }

  @Patch(':id')
  async update(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEnvironmentDto,
    @CurrentUser('sub') userId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (!(await this.authz.canManageProject(userId, projectId))) {
      throw new ForbiddenException('You do not have permission to update environments in this project');
    }
    return this.envService.update(projectId, id, dto);
  }
}
