import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsSseService } from './events-sse.service';

@Module({
  controllers: [EventsController],
  providers: [EventsSseService],
  exports: [EventsSseService],
})
export class EventsModule {}
