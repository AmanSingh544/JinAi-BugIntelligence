import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export const API_KEY_PROJECT = 'api_key_project';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const rawKey: string | undefined = request.headers['x-api-key'];

    if (!rawKey) {
      throw new UnauthorizedException('Missing X-API-Key header');
    }

    const hash = createHash('sha256').update(rawKey).digest('hex');
    const project = await this.prisma.project.findUnique({
      where: { api_key_hash: hash },
    });

    if (!project) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Origin check (soft filter)
    const origin: string | undefined = request.headers['origin'];
    if (origin && project.allowed_origins.length > 0) {
      const allowed = project.allowed_origins.some((o) => o === origin || o === '*');
      if (!allowed && project.block_unknown_origins) {
        throw new UnauthorizedException('Origin not allowed');
      }
    }

    request[API_KEY_PROJECT] = project;
    return true;
  }
}
