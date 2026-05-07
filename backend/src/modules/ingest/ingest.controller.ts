import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiKeyGuard, API_KEY_PROJECT } from '../../shared/guards/api-key.guard';
import { IngestRateLimitService } from '../../shared/rate-limit/ingest-rate-limit.service';
import { IngestQueue } from './ingest.queue';
import { BatchEventsDto } from './dto/batch-events.dto';
const MAX_PAYLOAD_BYTES = 512_000;
const MAX_EVENTS_PER_BATCH = 100;

@ApiTags('ingest')
@ApiSecurity('api-key')
@UseGuards(ApiKeyGuard)
@Controller('ingest')
export class IngestController {
  constructor(
    private readonly queue: IngestQueue,
    private readonly rateLimit: IngestRateLimitService,
  ) {}

  @Post('batch')
  @HttpCode(HttpStatus.ACCEPTED)
  async batch(@Req() req: Request, @Body() dto: BatchEventsDto) {
    const project = req[API_KEY_PROJECT] as { id: string };

    await this.rateLimit.checkAndIncrement(project.id);

    const payloadSize = Buffer.byteLength(JSON.stringify(dto));
    if (payloadSize > MAX_PAYLOAD_BYTES) {
      return { error: 'Payload too large', maxBytes: MAX_PAYLOAD_BYTES };
    }

    const events = dto.events.slice(0, MAX_EVENTS_PER_BATCH);

    await this.queue.add({
      projectId: project.id,
      sessionId: dto.sessionId,
      sessionMeta: dto.sessionMeta,
      events,
      receivedAt: Date.now(),
    });

    return { accepted: true, queued: events.length };
  }
}
