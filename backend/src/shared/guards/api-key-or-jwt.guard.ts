import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
  import { createHash } from 'crypto';
  import { verify } from 'jsonwebtoken';
  import { ConfigService } from '@nestjs/config';
  import { PrismaService } from '../prisma/prisma.service';
  import { AuthorizationService } from '../../modules/auth/authorization.service';
  import { API_KEY_PROJECT } from './api-key.guard';

  @Injectable()
  export class ApiKeyOrJwtGuard implements CanActivate {
    constructor(
      private readonly prisma: PrismaService,
      private readonly authz: AuthorizationService,
      private readonly config: ConfigService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
      const request = context.switchToHttp().getRequest();
      const apiKey: string | undefined = request.headers['x-api-key'];
      const authHeader: string | undefined = request.headers['authorization'];

      // ── API Key path ──────────────────────────────────────────────
      if (apiKey) {
        const hash = createHash('sha256').update(apiKey).digest('hex');
        const project = await this.prisma.project.findUnique({
          where: { api_key_hash: hash },
        });

        if (!project) {
          throw new UnauthorizedException('Invalid API key');
        }

        // Soft origin check (same as ApiKeyGuard)
        const origin: string | undefined = request.headers['origin'];
        if (origin && project.allowed_origins.length > 0) {
          const allowed = project.allowed_origins.some(
            (o) => o === origin || o === '*',
          );
          if (!allowed && project.block_unknown_origins) {
            throw new UnauthorizedException('Origin not allowed');
          }
        }

        request[API_KEY_PROJECT] = project;
        return true;
      }

      // ── JWT + Tenant path ─────────────────────────────────────────
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        try {
          const secret = this.config.get<string>('JWT_SECRET', 'fallback-secret');
          const payload = verify(token, secret) as {
            sub: string;
            email: string;
          };
          const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
          });
          if (!user) {
            throw new UnauthorizedException();
          }
          request.user = { sub: user.id, email: user.email };
        } catch {
          throw new UnauthorizedException('Invalid token');
        }

        const projectId =
          request.params?.projectId ?? request.params?.id;

        if (projectId) {
          const membership = await this.authz.resolveProjectMembership(
            request.user.sub,
            projectId,
          );
          if (!membership) {
            throw new ForbiddenException(
              'You do not have access to this project',
            );
          }
          request.tenantContext = membership;
        }
        return true;
      }

      throw new UnauthorizedException(
        'Authentication required: provide X-API-Key or Bearer token',
      );
    }
  }
