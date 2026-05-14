import { Controller, Get, Header, Req, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiKeyGuard, API_KEY_PROJECT } from '../../shared/guards/api-key.guard';
import { EnvironmentService } from '../environments/environment.service';

@ApiTags('sdk')
@ApiSecurity('api-key')
@UseGuards(ApiKeyGuard)
@Controller('sdk')
export class SdkController {
  constructor(private readonly envService: EnvironmentService) {}

  @Get('config')
  @Header('Cache-Control', 'max-age=60')
  async config(@Req() req: Request) {
    const project = req[API_KEY_PROJECT] as { id: string };
    const envName = req.headers['x-bi-environment'] as string | undefined;

    const env = await this.envService.resolveEnvironment(project.id, envName);

    if (!env) {
      return {
        version: 1,
        environment: 'production',
        sampling: {
          click: 1.0,
          navigation: 1.0,
          console: 1.0,
          api: 1.0,
          error: 1.0,
        },
        replayEnabled: false,
        screenshotOnError: false,
      };
    }

    return this.envService.buildSdkConfig(env);
  }
}
