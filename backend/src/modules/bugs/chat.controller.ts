import { Body, Controller, ForbiddenException, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/tenant-auth.guard';
import { AuthorizationService } from '../auth/authorization.service';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { ChatService } from './chat.service';

class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  message!: string;
}

@ApiTags('bugs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantAuthGuard)
@Controller('projects/:projectId/bugs/:bugId/chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly authz: AuthorizationService,
  ) {}

  @Get()
  async getThread(
    @Param('projectId') projectId: string,
    @Param('bugId') bugId: string,
    @CurrentUser('sub') userId: string,
  ) {
    const canAccess = await this.authz.canAccessAiChat(userId, bugId);
    if (!canAccess) {
      throw new ForbiddenException('You do not have access to this bug\'s chat');
    }
    return this.chatService.getOrCreateThread(projectId, bugId);
  }

  @Post()
  async sendMessage(
    @Param('projectId') projectId: string,
    @Param('bugId') bugId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser('sub') userId: string,
  ) {
    const canAccess = await this.authz.canAccessAiChat(userId, bugId);
    if (!canAccess) {
      throw new ForbiddenException('You do not have access to this bug\'s chat');
    }
    return this.chatService.sendMessage(projectId, bugId, dto.message);
  }
}
