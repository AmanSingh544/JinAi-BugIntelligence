import { Module } from '@nestjs/common';
import { SdkController } from './sdk.controller';
import { EnvironmentsModule } from '../environments/environments.module';

@Module({
  imports: [EnvironmentsModule],
  controllers: [SdkController],
})
export class SdkModule {}
