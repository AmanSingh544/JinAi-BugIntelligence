import { Controller, Get, Query, Redirect, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/tenant-auth.guard';
import { GitHubAppService } from './github-app.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

@ApiTags('github-app')
@Controller('github-app')
export class GitHubAppController {
  constructor(
    private readonly githubApp: GitHubAppService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('install-url')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantAuthGuard)
  @ApiOperation({ summary: 'Get GitHub App installation URL for a project' })
  @ApiQuery({ name: 'projectId', required: true })
  getInstallUrl(@Query('projectId') projectId: string) {
    return { url: this.githubApp.getInstallUrl(projectId) };
  }

  @Get('callback')
  @ApiOperation({
    summary: 'GitHub App installation callback — stores installation_id against the project',
    description: 'GitHub redirects here after the user installs the App. The `state` param contains the projectId.',
  })
  @ApiQuery({ name: 'installation_id', required: true })
  @ApiQuery({ name: 'state', required: true, description: 'projectId passed as state during install' })
  @Redirect()
  async callback(
    @Query('installation_id') installationId: string,
    @Query('state') projectId: string,
  ) {
    // Store or update the installation_id on the project's repository record if it already exists
    const existing = await this.prisma.projectRepository.findUnique({
      where: { project_id: projectId },
    });

    if (existing) {
      await this.prisma.projectRepository.update({
        where: { project_id: projectId },
        data: { installation_id: parseInt(installationId, 10) },
      });
    }
    // Redirect to the project settings page with the installation_id pre-filled
    // Dashboard reads ?github_installed=1&installation_id=... to auto-populate the connect form
    const dashboardUrl = process.env.DASHBOARD_URL ?? process.env.MERIDIAN_BASE_URL ?? 'http://localhost:5173';
    return {
      url: `${dashboardUrl}/projects/${projectId}/settings?github_installed=1&installation_id=${installationId}`,
      statusCode: 302,
    };
  }
}
