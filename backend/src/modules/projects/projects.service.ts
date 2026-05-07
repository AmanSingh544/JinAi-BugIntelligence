import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateProjectDto) {
    const rawKey = `bi_live_${randomBytes(32).toString('hex')}`;
    const hash = createHash('sha256').update(rawKey).digest('hex');

    const project = await this.prisma.project.create({
      data: {
        user_id: userId,
        name: dto.name,
        api_key_hash: hash,
        allowed_origins: dto.allowed_origins ?? [],
        block_unknown_origins: dto.block_unknown_origins ?? false,
        clustering_threshold: dto.clustering_threshold ?? 0.15,
      },
      select: { id: true, name: true, allowed_origins: true, clustering_threshold: true, created_at: true },
    });

    // Return raw key only once — never stored
    return { ...project, api_key: rawKey };
  }

  async findAll(userId: string) {
    return this.prisma.project.findMany({
      where: { user_id: userId },
      select: { id: true, name: true, allowed_origins: true, clustering_threshold: true, created_at: true },
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(userId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, user_id: userId },
      select: { id: true, name: true, allowed_origins: true, block_unknown_origins: true, clustering_threshold: true, created_at: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async rotateApiKey(userId: string, projectId: string) {
    const existing = await this.findOne(userId, projectId);
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
