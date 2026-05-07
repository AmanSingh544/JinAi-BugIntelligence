import { Module } from '@nestjs/common';
import { BugsController } from './bugs.controller';

@Module({
  controllers: [BugsController],
})
export class BugsModule {}
