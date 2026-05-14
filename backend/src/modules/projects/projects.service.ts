import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { EnvironmentService } from '../environments/environment.service';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly envService: EnvironmentService,
  ) {}

  async create(tenantId: string, dto: CreateProjectDto) {
    const rawKey = `bi_live_${randomBytes(32).toString('hex')}`;
    const hash = createHash('sha256').update(rawKey).digest('hex');

    const project = await this.prisma.project.create({
      data: {
        tenant_id: tenantId,
        name: dto.name,
        api_key_hash: hash,
        allowed_origins: dto.allowed_origins ?? [],
        block_unknown_origins: dto.block_unknown_origins ?? false,
        clustering_threshold: dto.clustering_threshold ?? 0.15,
      },
      select: { id: true, name: true, allowed_origins: true, clustering_threshold: true, created_at: true },
    });

    // Create default environments
    await this.envService.createDefaults(project.id);

    // Return raw key only once — never stored
    return { ...project, api_key: rawKey };
  }

  async findAll(tenantId: string) {
    return this.prisma.project.findMany({
      where: { tenant_id: tenantId },
      select: { id: true, name: true, allowed_origins: true, clustering_threshold: true, created_at: true },
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(tenantId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, tenant_id: tenantId },
      select: { id: true, name: true, allowed_origins: true, block_unknown_origins: true, clustering_threshold: true, created_at: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async rotateApiKey(tenantId: string, projectId: string) {
    const existing = await this.findOne(tenantId, projectId);
    if (!existing) throw new NotFoundException('Project not found');

    const rawKey = `bi_live_${randomBytes(32).toString('hex')}`;
    const hash = createHash('sha256').update(rawKey).digest('hex');

    await this.prisma.project.update({
      where: { id: projectId },
      data: { api_key_hash: hash },
    });

    return { api_key: rawKey };
  }
}
