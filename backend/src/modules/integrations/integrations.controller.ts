import {
  BadRequestException,
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
import { IntegrationRegistry } from './providers/integration.registry';

@ApiTags('integrations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantAuthGuard)
@Controller('projects/:projectId/integrations')
export class IntegrationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: IntegrationRegistry,
    private readonly authz: AuthorizationService,
  ) {}

  @Get()
  async list(@Param('projectId') projectId: string) {
    return this.prisma.projectIntegration.findMany({
      where: { project_id: projectId },
      orderBy: { created_at: 'desc' },
    });
  }

  @Post()
  async create(
    @Param('projectId') projectId: string,
    @Body() body: { provider_id: string; config: Record<string, unknown>; is_active?: boolean },
    @CurrentUser('sub') userId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (!(await this.authz.canCreateIntegration(userId, projectId))) {
      throw new ForbiddenException('You do not have permission to create integrations in this project');
    }
    if (body.provider_id === 'generic_http') {
      validateGenericConfig(body.config);
    }
    return this.prisma.projectIntegration.create({
      data: {
        project_id: projectId,
        provider_id: body.provider_id,
        config: body.config as object,
        is_active: body.is_active ?? true,
      },
    });
  }

  @Post(':id/validate')
  async validate(
    @Param('projectId') _projectId: string,
    @Param('id') id: string,
  ) {
    const integration = await this.prisma.projectIntegration.findUnique({ where: { id } });
    if (!integration) return { valid: false, error: 'Integration not found' };

    const provider = this.registry.get(integration.provider_id);
    try {
      const valid = await provider.validateCredentials(integration.config as Record<string, unknown> as Record<string, string | number | boolean | null>);
      return { valid };
    } catch (err) {
      return { valid: false, error: (err as Error).message };
    }
  }

  @Patch(':id')
  async update(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: { config?: Record<string, unknown>; is_active?: boolean },
    @CurrentUser('sub') userId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (!(await this.authz.canManageProject(userId, projectId))) {
      throw new ForbiddenException('You do not have permission to update integrations in this project');
    }
    const integration = await this.prisma.projectIntegration.findUnique({ where: { id } });
    if (body.config !== undefined && integration?.provider_id === 'generic_http') {
      validateGenericConfig(body.config);
    }

    const data: Record<string, unknown> = {};
    if (body.config !== undefined) data.config = body.config;
    if (body.is_active !== undefined) data.is_active = body.is_active;

    return this.prisma.projectIntegration.update({
      where: { id },
      data,
    });
  }

  @Delete(':id')
  async remove(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (!(await this.authz.canManageProject(userId, projectId))) {
      throw new ForbiddenException('You do not have permission to delete integrations in this project');
    }
    await this.prisma.projectIntegration.delete({ where: { id } });
    return { deleted: true };
  }
}

@Controller('integrations')
export class IntegrationProvidersController {
  constructor(private readonly registry: IntegrationRegistry) {}

  @Get('providers')
  list() {
    return this.registry.list();
  }
}

function validateGenericConfig(config: Record<string, unknown>): void {
  const baseUrl = config.baseUrl;
  if (!baseUrl || typeof baseUrl !== 'string') {
    throw new BadRequestException('generic_http: baseUrl is required');
  }

  const auth = config.auth as Record<string, unknown> | undefined;
  if (!auth || !auth.type || typeof auth.type !== 'string') {
    throw new BadRequestException('generic_http: auth.type is required');
  }
  const validAuthTypes = ['none', 'bearer', 'basic', 'api_key', 'cookie'];
  if (!validAuthTypes.includes(auth.type)) {
    throw new BadRequestException(`generic_http: invalid auth.type "${auth.type}"`);
  }

  const endpoints = config.endpoints as Record<string, unknown> | undefined;
  const createTicket = endpoints?.createTicket as Record<string, unknown> | undefined;
  if (!createTicket?.url || typeof createTicket.url !== 'string') {
    throw new BadRequestException('generic_http: endpoints.createTicket.url is required');
  }
  const validMethods = ['POST', 'PUT', 'PATCH'];
  if (!createTicket.method || !validMethods.includes(createTicket.method as string)) {
    throw new BadRequestException('generic_http: endpoints.createTicket.method must be POST, PUT, or PATCH');
  }

  const templates = config.templates as Record<string, unknown> | undefined;
  if (!templates?.body) {
    throw new BadRequestException('generic_http: templates.body is required');
  }

  // Validate body is valid JSON
  try {
    JSON.stringify(templates.body);
  } catch {
    throw new BadRequestException('generic_http: templates.body must be valid JSON');
  }

  const responseMapping = config.responseMapping as Record<string, unknown> | undefined;
  if (!responseMapping?.ticketIdPath || typeof responseMapping.ticketIdPath !== 'string') {
    throw new BadRequestException('generic_http: responseMapping.ticketIdPath is required');
  }
}
