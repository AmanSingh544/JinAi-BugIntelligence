import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  PaginationDto,
  PaginatedResult,
} from '../../shared/dto/pagination.dto';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/tenant-auth.guard';
import {
  ApiKeyGuard,
  API_KEY_PROJECT,
} from '../../shared/guards/api-key.guard';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { Req } from '@nestjs/common';

@ApiTags('sessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantAuthGuard)
@Controller('projects/:projectId/sessions')
export class SessionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findAll(
    @Param('projectId') projectId: string,
    @Query() pagination: PaginationDto,
  ): Promise<PaginatedResult<unknown>> {
    const where = { project_id: projectId };
    const skip = (pagination.page! - 1) * pagination.limit!;
    const [items, total] = await Promise.all([
      this.prisma.session.findMany({
        where,
        orderBy: { started_at: 'desc' },
        skip,
        take: pagination.limit,
      }),
      this.prisma.session.count({ where }),
    ]);
    return { items, total };
  }

  @Get(':sessionId/replay')
  async getReplay(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
  ) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, project_id: projectId },
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const segments = await this.prisma.replaySegment.findMany({
      where: { session_id: sessionId, project_id: projectId },
      orderBy: [{ sequence: 'asc' }, { created_at: 'asc' }],
    });

    const allEvents = segments.flatMap((s) => s.events as unknown[]);
    return { events: allEvents };
  }

  @Get(':sessionId/timeline')
  async getTimeline(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Query('limit') limit?: string,
  ) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, project_id: projectId },
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const take = Math.min(parseInt(limit ?? '200', 10) || 200, 500);

    const hotEvents = await this.prisma.event.findMany({
      where: { session_id: sessionId, project_id: projectId },
      orderBy: { timestamp: 'asc' },
      take,
      select: {
        id: true,
        type: true,
        timestamp: true,
        payload: true,
      },
    });

    let allEvents = hotEvents;
    const remaining = take - hotEvents.length;
    if (remaining > 0) {
      const archived = await this.prisma.eventArchive.findMany({
        where: { session_id: sessionId, project_id: projectId },
        orderBy: { timestamp: 'asc' },
        take: remaining,
        select: {
          id: true,
          type: true,
          timestamp: true,
          payload: true,
        },
      });
      // Deduplicate by id in case an event exists in both tables
      const seen = new Set(hotEvents.map((e) => e.id));
      allEvents = [...hotEvents, ...archived.filter((e) => !seen.has(e.id))];
    }

    const displayEvents = allEvents.map((e) => {
      const payload = e.payload as Record<string, unknown>;
      let display: Record<string, unknown> = {};

      switch (e.type) {
        case 'click':
          display = {
            selector: payload.selector ?? 'unknown',
            text: payload.text ?? undefined,
          };
          break;
        case 'input':
          display = {
            tag: payload.tag ?? 'input',
            inputType: payload.inputType ?? 'text',
            name: payload.name ?? undefined,
            valueLength: payload.valueLength ?? 0,
            isPassword: payload.isPassword ?? false,
            selector: payload.selector ?? 'unknown',
          };
          break;
        case 'navigation':
          display = {
            from: payload.from ?? 'unknown',
            to: payload.to ?? 'unknown',
          };
          break;
        case 'api_request':
          display = {
            method: payload.method ?? 'GET',
            url: payload.url ?? 'unknown',
          };
          break;
        case 'api_response':
          display = {
            method: payload.method ?? 'GET',
            url: payload.url ?? 'unknown',
            status: payload.status ?? 0,
          };
          break;
        case 'console':
          display = {
            level: payload.level ?? 'log',
            message: payload.message ?? '',
          };
          break;
        case 'error':
          display = {
            message: payload.message ?? 'Unknown error',
            file: payload.file ?? undefined,
            line: payload.line ?? undefined,
          };
          break;
        default:
          display = payload;
      }

      return {
        id: e.id,
        type: e.type,
        timestamp: Number(e.timestamp),
        payload: display,
      };
    });

    return { events: displayEvents };
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

    // Hard limit: reject oversized segments. Full DOM snapshots of rich SPAs
    // run well past 500KB, so the cap matches the 5MB body-parser limit's
    // practical headroom.
    const MAX_SEGMENT_BYTES = 2 * 1024 * 1024;
    const payloadSize = Buffer.byteLength(JSON.stringify(body.events));
    if (payloadSize > MAX_SEGMENT_BYTES) {
      return { error: 'Segment too large', maxBytes: MAX_SEGMENT_BYTES };
    }

    // Replay flush can legitimately arrive before the first event batch has
    // created the session row — upsert so the segment never FK-fails.
    await this.prisma.session.upsert({
      where: { id: sessionId },
      create: { id: sessionId, project_id: project.id },
      update: {},
    });

    await this.prisma.replaySegment.create({
      data: {
        session_id: sessionId,
        project_id: project.id,
        sequence: body.sequence,
        events: body.events as Prisma.InputJsonValue,
      },
    });

    return { accepted: true };
  }
}
