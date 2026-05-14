import { Module } from '@nestjs/common';
import { SessionsController, ReplayController } from './sessions.controller';

@Module({
  controllers: [SessionsController, ReplayController],
})
export class SessionsModule {}
