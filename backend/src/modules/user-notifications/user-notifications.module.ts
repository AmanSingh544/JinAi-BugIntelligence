import { Module } from '@nestjs/common';
import { UserNotificationsService } from './user-notifications.service';
import { UserNotificationsController } from './user-notifications.controller';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [EventsModule],
  providers: [UserNotificationsService],
  controllers: [UserNotificationsController],
  exports: [UserNotificationsService],
})
export class UserNotificationsModule {}
