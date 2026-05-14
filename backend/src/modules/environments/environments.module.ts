import { Module } from '@nestjs/common';
import { EnvironmentService } from './environment.service';
import { EnvironmentsController } from './environments.controller';

@Module({
  providers: [EnvironmentService],
  controllers: [EnvironmentsController],
  exports: [EnvironmentService],
})
export class EnvironmentsModule {}
