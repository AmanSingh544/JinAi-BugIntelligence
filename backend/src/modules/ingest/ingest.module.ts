import { Module } from '@nestjs/common';
import { IngestController } from './ingest.controller';
import { IngestQueue } from './ingest.queue';
import { IngestWorker } from './ingest.worker';
import { ApiKeyGuard } from '../../shared/guards/api-key.guard';
import { IngestRateLimitService } from '../../shared/rate-limit/ingest-rate-limit.service';
import { ErrorsModule } from '../errors/errors.module';
import { EnvironmentsModule } from '../environments/environments.module';
import { SanitizationService } from './sanitization.service';

@Module({
  imports: [ErrorsModule, EnvironmentsModule],
  controllers: [IngestController],
  providers: [IngestQueue, IngestWorker, ApiKeyGuard, IngestRateLimitService, SanitizationService],
})
export class IngestModule {}
