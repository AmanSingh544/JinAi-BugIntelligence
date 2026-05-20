import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { GitHubAppService } from '../autofix/github-app.service';
import { ConnectRepositoryDto } from './dto/connect-repository.dto';
import { UpdateRepositoryDto } from './dto/update-repository.dto';

@Injectable()
export class ProjectRepositoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly githubApp: GitHubAppService,
  ) {}

  async connect(projectId: string, dto: ConnectRepositoryDto) {
    const existing = await this.prisma.projectRepository.findUnique({
      where: { project_id: projectId },
    });
    if (existing) {
      throw new ConflictException('A repository is already connected to this project. Use PATCH to update it.');
    }

    return this.prisma.projectRepository.create({
      data: {
        project_id: projectId,
        github_owner: dto.github_owner,
        github_repo: dto.github_repo,
        default_branch: dto.default_branch ?? 'main',
        source_root_prefix: dto.source_root_prefix ?? '',
        path_overrides: dto.path_overrides ?? {},
        installation_id: dto.installation_id,
        // webhook_secret is unused — global GITHUB_WEBHOOK_SECRET in GitHubAppService handles HMAC
        webhook_secret: '',
        merge_strategy: dto.merge_strategy ?? 'squash',
        auto_merge_enabled: dto.auto_merge_enabled ?? false,
        min_severity: dto.min_severity ?? 'high',
        fix_confidence_min: dto.fix_confidence_min ?? 0.75,
      },
    });
  }

  async findOne(projectId: string) {
    const repo = await this.prisma.projectRepository.findUnique({
      where: { project_id: projectId },
    });
    if (!repo) throw new NotFoundException('No repository connected to this project');
    return repo;
  }

  async update(projectId: string, dto: UpdateRepositoryDto) {
    const existing = await this.prisma.projectRepository.findUnique({
      where: { project_id: projectId },
    });
    if (!existing) throw new NotFoundException('No repository connected to this project');

    return this.prisma.projectRepository.update({
      where: { project_id: projectId },
      data: {
        ...(dto.github_owner !== undefined && { github_owner: dto.github_owner }),
        ...(dto.github_repo !== undefined && { github_repo: dto.github_repo }),
        ...(dto.default_branch !== undefined && { default_branch: dto.default_branch }),
        ...(dto.source_root_prefix !== undefined && { source_root_prefix: dto.source_root_prefix }),
        ...(dto.path_overrides !== undefined && { path_overrides: dto.path_overrides }),
        ...(dto.installation_id !== undefined && { installation_id: dto.installation_id }),
        ...(dto.merge_strategy !== undefined && { merge_strategy: dto.merge_strategy }),
        ...(dto.auto_merge_enabled !== undefined && { auto_merge_enabled: dto.auto_merge_enabled }),
        ...(dto.min_severity !== undefined && { min_severity: dto.min_severity }),
        ...(dto.fix_confidence_min !== undefined && { fix_confidence_min: dto.fix_confidence_min }),
      },
    });
  }

  async disconnect(projectId: string) {
    const existing = await this.prisma.projectRepository.findUnique({
      where: { project_id: projectId },
    });
    if (!existing) throw new NotFoundException('No repository connected to this project');

    await this.prisma.projectRepository.delete({ where: { project_id: projectId } });
    return { message: 'Repository disconnected successfully' };
  }

  async validateConnection(projectId: string): Promise<{ valid: boolean; message: string }> {
    const repo = await this.prisma.projectRepository.findUnique({
      where: { project_id: projectId },
    });
    if (!repo) return { valid: false, message: 'No repository connected' };

    try {
      const response = await this.githubApp.apiRequest(
        repo.installation_id,
        `/repos/${repo.github_owner}/${repo.github_repo}`,
      );
      if (response.ok) {
        return { valid: true, message: `Connected to ${repo.github_owner}/${repo.github_repo}` };
      }
      return { valid: false, message: `GitHub returned ${response.status}` };
    } catch (err) {
      return { valid: false, message: (err as Error).message };
    }
  }
}
