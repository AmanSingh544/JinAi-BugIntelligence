import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventsModule } from '../events/events.module';
import { GitHubAppService } from './github-app.service';
import { GitHubAppController } from './github-app.controller';
import { SourceFetcherService } from './source-fetcher.service';
import { FixGenerationQueue } from './fix-generation.queue';
import { FixGenerationWorker } from './fix-generation.worker';
import { FixPromptService } from './fix-prompt.service';
import { PatchApplicatorService } from './patch-applicator.service';
import { FixValidatorService } from './fix-validator.service';
import { FixPrQueue } from './fix-pr.queue';
import { FixPrWorker } from './fix-pr.worker';
import { FixPrMonitorService } from './fix-pr-monitor.service';
import { REDIS_CLIENT } from '../../shared/redis/redis.provider';
import type Redis from 'ioredis';

@Module({
  imports: [ConfigModule, EventsModule],
  controllers: [GitHubAppController],
  providers: [
    GitHubAppService,
    SourceFetcherService,
    FixPromptService,
    PatchApplicatorService,
    FixValidatorService,
    FixGenerationWorker,
    FixPrWorker,
    FixPrMonitorService,
    {
      provide: FixGenerationQueue,
      useFactory: (redis: Redis) => new FixGenerationQueue(redis),
      inject: [REDIS_CLIENT],
    },
    {
      provide: FixPrQueue,
      useFactory: (redis: Redis) => new FixPrQueue(redis),
      inject: [REDIS_CLIENT],
    },
  ],
  exports: [GitHubAppService, SourceFetcherService, FixGenerationQueue],
})
export class AutofixModule {}
