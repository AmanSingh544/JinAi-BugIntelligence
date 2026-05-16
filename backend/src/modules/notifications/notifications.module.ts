import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationService } from './notification.service';
import { NotificationQueue } from './notification.queue';
import { NotificationWorker } from './notification.worker';
import { NotificationRegistry } from './providers/notification.registry';
import { SlackProvider } from './providers/slack.provider';
import { EmailProvider } from './providers/email.provider';
import { TeamsProvider } from './providers/teams.provider';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [
    NotificationService,
    NotificationQueue,
    NotificationWorker,
    NotificationRegistry,
    SlackProvider,
    EmailProvider,
    TeamsProvider,
  ],
  controllers: [NotificationsController],
  exports: [NotificationService],
})
export class NotificationsModule {}
