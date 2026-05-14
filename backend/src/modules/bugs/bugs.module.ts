import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BugsController } from './bugs.controller';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [ConfigModule],
  controllers: [BugsController, ChatController],
  providers: [ChatService],
})
export class BugsModule {}
