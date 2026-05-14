import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/tenant-auth.guard';
import { ApiKeyGuard, API_KEY_PROJECT } from '../../shared/guards/api-key.guard';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { Request } from 'express';
import { Req } from '@nestjs/common';

@ApiTags('sessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantAuthGuard)
@Controller('projects/:projectId/sessions')
export class SessionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findAll(@Param('projectId') projectId: string) {
    return this.prisma.session.findMany({
      where: { project_id: projectId },
      orderBy: { started_at: 'desc' },
      take: 100,
    });
  }

  @Get(':sessionId/replay')
  async getReplay(@Param('projectId') projectId: string, @Param('sessionId') sessionId: string) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, project_id: projectId },
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const segments = await this.prisma.replaySegment.findMany({
      where: { session_id: sessionId, project_id: projectId },
      orderBy: { sequence: 'asc' },
    });

    const allEvents = segments.flatMap((s) => s.events as unknown[]);
    return { events: allEvents };
  }
}

@ApiTags('replay')
@ApiSecurity('api-key')
@UseGuards(ApiKeyGuard)
@Controller('sessions/:sessionId/replay')
export class ReplayController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async upload(
    @Req() req: Request,
    @Param('sessionId') sessionId: string,
    @Body() body: { sequence: number; events: unknown[] },
  ) {
    const project = req[API_KEY_PROJECT] as { id: string };

    // Hard limit: reject segments > 500KB
    const payloadSize = Buffer.byteLength(JSON.stringify(body.events));
    if (payloadSize > 500 * 1024) {
      return { error: 'Segment too large', maxBytes: 500 * 1024 };
    }

    await this.prisma.replaySegment.create({
      data: {
        session_id: sessionId,
        project_id: project.id,
        sequence: body.sequence,
        events: body.events as object,
      },
    });

    return { accepted: true };
  }

  @Get()
  async get(@Param('sessionId') sessionId: string) {
    const segments = await this.prisma.replaySegment.findMany({
      where: { session_id: sessionId },
      orderBy: { sequence: 'asc' },
    });

    const allEvents = segments.flatMap((s) => s.events as unknown[]);
    return { events: allEvents };
  }
}
