import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../shared/prisma/prisma.service';

/**
 * Unauthenticated liveness probe for uptime monitors and the reverse proxy.
 * Exposes nothing but "up or not" — a failed DB round-trip fails the probe.
 */
@ApiTags('system')
@Controller('healthz')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  }
}
