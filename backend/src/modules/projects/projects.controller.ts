import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { PrismaService } from '../../shared/prisma/prisma.service';

@ApiTags('projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly prisma: PrismaService,
  ) {}

  private async resolveTenantId(userId: string): Promise<string> {
    const member = await this.prisma.tenantMember.findFirst({
      where: { user_id: userId },
      select: { tenant_id: true },
      orderBy: { created_at: 'asc' },
    });
    if (!member) throw new Error('User has no tenant membership');
    return member.tenant_id;
  }

  @Post()
  async create(@CurrentUser('sub') userId: string, @Body() dto: CreateProjectDto) {
    const tenantId = await this.resolveTenantId(userId);
    return this.projects.create(tenantId, dto);
  }

  @Get()
  async findAll(@CurrentUser('sub') userId: string) {
    const tenantId = await this.resolveTenantId(userId);
    return this.projects.findAll(tenantId);
  }

  @Get(':id')
  async findOne(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    const tenantId = await this.resolveTenantId(userId);
    return this.projects.findOne(tenantId, id);
  }

  @Post(':id/rotate-key')
  async rotateKey(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    const tenantId = await this.resolveTenantId(userId);
    return this.projects.rotateApiKey(tenantId, id);
  }
}
