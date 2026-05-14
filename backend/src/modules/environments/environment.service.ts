import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { ProjectEnvironment } from '@prisma/client';

export interface SdkConfig {
  version: number;
  environment: string;
  sampling: {
    click: number;
    navigation: number;
    console: number;
    api: number;
    error: number;
  };
  replayEnabled: boolean;
  screenshotOnError: boolean;
}

const DEFAULT_ENVIRONMENTS: Array<{
  name: string;
  replay_enabled: boolean;
  screenshot_on_error: boolean;
  sampling_click: number;
  sampling_navigation: number;
  sampling_console: number;
  sampling_api: number;
  sampling_error: number;
}> = [
  {
    name: 'development',
    replay_enabled: true,
    screenshot_on_error: true,
    sampling_click: 1.0,
    sampling_navigation: 1.0,
    sampling_console: 1.0,
    sampling_api: 1.0,
    sampling_error: 1.0,
  },
  {
    name: 'staging',
    replay_enabled: true,
    screenshot_on_error: true,
    sampling_click: 0.5,
    sampling_navigation: 0.5,
    sampling_console: 0.5,
    sampling_api: 1.0,
    sampling_error: 1.0,
  },
  {
    name: 'production',
    replay_enabled: false,
    screenshot_on_error: true,
    sampling_click: 0.1,
    sampling_navigation: 0.1,
    sampling_console: 0.1,
    sampling_api: 1.0,
    sampling_error: 1.0,
  },
];

@Injectable()
export class EnvironmentService {
  constructor(private readonly prisma: PrismaService) {}

  async createDefaults(projectId: string): Promise<ProjectEnvironment[]> {
    const data = DEFAULT_ENVIRONMENTS.map((env) => ({
      ...env,
      project_id: projectId,
    }));

    await this.prisma.projectEnvironment.createMany({ data });

    return this.prisma.projectEnvironment.findMany({
      where: { project_id: projectId },
    });
  }

  async findByProject(projectId: string): Promise<ProjectEnvironment[]> {
    return this.prisma.projectEnvironment.findMany({
      where: { project_id: projectId },
      orderBy: { created_at: 'asc' },
    });
  }

  async findOne(projectId: string, envId: string): Promise<ProjectEnvironment> {
    const env = await this.prisma.projectEnvironment.findFirst({
      where: { id: envId, project_id: projectId },
    });
    if (!env) throw new NotFoundException('Environment not found');
    return env;
  }

  async update(
    projectId: string,
    envId: string,
    dto: Partial<Pick<ProjectEnvironment, 'sampling_click' | 'sampling_navigation' | 'sampling_console' | 'sampling_api' | 'sampling_error' | 'replay_enabled' | 'screenshot_on_error' | 'retention_events_days' | 'retention_sessions_days' | 'retention_replay_days' | 'retention_screenshots_days' | 'retention_bug_detail_days' | 'retention_dlq_days'>>,
  ): Promise<ProjectEnvironment> {
    const env = await this.findOne(projectId, envId);

    const updates: Record<string, number | boolean> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value === undefined) continue;
      if (key.startsWith('sampling_')) {
        const num = Number(value);
        if (Number.isNaN(num) || num < 0 || num > 1) {
          throw new BadRequestException(`${key} must be between 0 and 1`);
        }
        updates[key] = num;
      } else if (key.startsWith('retention_')) {
        const num = Number(value);
        if (Number.isNaN(num) || num < 0 || num > 3650) {
          throw new BadRequestException(`${key} must be between 0 and 3650`);
        }
        updates[key] = num;
      } else {
        updates[key] = Boolean(value);
      }
    }

    return this.prisma.projectEnvironment.update({
      where: { id: envId },
      data: {
        ...updates,
        config_version: env.config_version + 1,
      },
    });
  }

  async resolveEnvironment(
    projectId: string,
    envName?: string | null,
  ): Promise<ProjectEnvironment | null> {
    if (envName) {
      const env = await this.prisma.projectEnvironment.findUnique({
        where: { project_id_name: { project_id: projectId, name: envName } },
      });
      if (env) return env;
    }

    // Fallback to production, then first available
    const envs = await this.prisma.projectEnvironment.findMany({
      where: { project_id: projectId },
      orderBy: { created_at: 'asc' },
    });

    return envs.find((e) => e.name === 'production') ?? envs[0] ?? null;
  }

  buildSdkConfig(env: ProjectEnvironment): SdkConfig {
    return {
      version: env.config_version,
      environment: env.name,
      sampling: {
        click: env.sampling_click,
        navigation: env.sampling_navigation,
        console: env.sampling_console,
        api: env.sampling_api,
        error: env.sampling_error,
      },
      replayEnabled: env.replay_enabled,
      screenshotOnError: env.screenshot_on_error,
    };
  }
}
