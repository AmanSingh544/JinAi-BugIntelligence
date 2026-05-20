import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BugsController } from './bugs.controller';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { EventsModule } from '../events/events.module';
import { AuditModule } from '../audit/audit.module';
import { ArchiveQueue } from './archive.queue';
import { ArchiveWorker } from './archive.worker';
import { AutofixModule } from '../autofix/autofix.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [ConfigModule, EventsModule, AuditModule, AutofixModule, IntegrationsModule],
  controllers: [BugsController, ChatController],
  providers: [ChatService, ArchiveQueue, ArchiveWorker],
})
export class BugsModule {}
