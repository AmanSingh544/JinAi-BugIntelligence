import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RetentionService } from './retention.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
