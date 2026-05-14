import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { NotificationQueue } from './notification.queue';
import type { BugNotificationPayload } from './providers/notification.interface';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationQueue: NotificationQueue,
  ) {}

  async sendToProject(projectId: string, bugId: string): Promise<void> {
    const channels = await this.prisma.notificationChannel.findMany({
      where: { project_id: projectId, is_active: true },
    });

    if (channels.length === 0) return;

    const bug = await this.prisma.bug.findUnique({
      where: { id: bugId },
      include: { error: true, session: true },
    });

    if (!bug) {
      this.logger.warn(`Bug ${bugId} not found for notification`);
      return;
    }

    for (const channel of channels) {
      // Create pending log entry
      const log = await this.prisma.notificationLog.create({
        data: {
          channel_id: channel.id,
          bug_id: bugId,
          status: 'pending',
        },
      });

      // Enqueue async notification job
      await this.notificationQueue.add({
        channelId: channel.id,
        bugId,
        logId: log.id,
        attempt: 1,
      });

      this.logger.debug(`Notification queued for channel ${channel.id} bug ${bugId}`);
    }
  }
}
