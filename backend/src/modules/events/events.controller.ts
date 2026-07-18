import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EventsSseService } from './events-sse.service';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { PrismaService } from '../../shared/prisma/prisma.service';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(
    private readonly sse: EventsSseService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('stream')
  async stream(
    @Query('token') token: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!token) {
      throw new ForbiddenException('Token required');
    }

    let userId: string;
    try {
      const secret = this.config.get<string>('JWT_SECRET') ?? 'default-secret';
      const payload = jwt.verify(token, secret) as { sub: string };
      userId = payload.sub;
    } catch {
      throw new ForbiddenException('Invalid token');
    }

    const members = await this.prisma.tenantMember.findMany({
      where: { user_id: userId },
      select: { tenant_id: true },
    });
    const tenantIds = members.map((m) => m.tenant_id);

    const clientId = randomUUID();

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();

    this.sse.subscribe({
      id: clientId,
      userId,
      tenantIds,
      response: res,
    });

    req.on('close', () => {
      this.sse.unsubscribe(clientId);
    });
  }
}
