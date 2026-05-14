import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MetricsService } from '../../shared/metrics/metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async getMetrics(@Res() res: Response) {
    const metrics = await this.metrics.registry.metrics();
    res.set('Content-Type', this.metrics.registry.contentType);
    res.send(metrics);
  }
}
