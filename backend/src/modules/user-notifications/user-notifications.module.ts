import { Module } from '@nestjs/common';
import { UserNotificationsService } from './user-notifications.service';
import { UserNotificationsController } from './user-notifications.controller';

@Module({
  providers: [UserNotificationsService],
  controllers: [UserNotificationsController],
  exports: [UserNotificationsService],
})
export class UserNotificationsModule {}
