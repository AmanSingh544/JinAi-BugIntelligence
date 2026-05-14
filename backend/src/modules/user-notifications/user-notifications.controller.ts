import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { UserNotificationsService } from './user-notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class UserNotificationsController {
  constructor(private readonly service: UserNotificationsService) {}

  @Get()
  async list(
    @CurrentUser('sub') userId: string,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.list(userId, {
      unreadOnly: unreadOnly === 'true',
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser('sub') userId: string) {
    const { unreadCount } = await this.service.list(userId, { unreadOnly: true, limit: 1 });
    return { unreadCount };
  }

  @Patch(':id/read')
  async markAsRead(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    await this.service.markAsRead(userId, id);
    return { success: true };
  }

  @Patch('read-all')
  async markAllAsRead(@CurrentUser('sub') userId: string) {
    await this.service.markAllAsRead(userId);
    return { success: true };
  }

  @Delete(':id')
  async delete(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    await this.service.delete(userId, id);
    return { success: true };
  }
}
