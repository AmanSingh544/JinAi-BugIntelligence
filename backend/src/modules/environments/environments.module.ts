import { Module } from '@nestjs/common';
import { EnvironmentService } from './environment.service';
import { EnvironmentsController } from './environments.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [EnvironmentService],
  controllers: [EnvironmentsController],
  exports: [EnvironmentService],
})
export class EnvironmentsModule {}
