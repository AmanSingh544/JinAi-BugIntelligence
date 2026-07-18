import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { EventsSseService } from '../events/events-sse.service';

@Injectable()
export class UserNotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sse: EventsSseService,
  ) {}

  async list(
    userId: string,
    opts: { unreadOnly?: boolean; limit?: number; offset?: number } = {},
  ) {
    const { unreadOnly = false, limit = 50, offset = 0 } = opts;
    const where = {
      user_id: userId,
      ...(unreadOnly ? { read_at: null } : {}),
    };

    const [items, total, unreadCount] = await Promise.all([
      this.prisma.userNotification.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: limit,
        skip: offset,
        include: {
          project: { select: { id: true, name: true } },
          bug: { select: { id: true, summary: true } },
        },
      }),
      this.prisma.userNotification.count({ where: { user_id: userId } }),
      this.prisma.userNotification.count({
        where: { user_id: userId, read_at: null },
      }),
    ]);

    return { items, total, unreadCount };
  }

  async markAsRead(userId: string, notificationId: string) {
    return this.prisma.userNotification.updateMany({
      where: { id: notificationId, user_id: userId },
      data: { read_at: new Date() },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.userNotification.updateMany({
      where: { user_id: userId, read_at: null },
      data: { read_at: new Date() },
    });
  }

  async delete(userId: string, notificationId: string) {
    return this.prisma.userNotification.deleteMany({
      where: { id: notificationId, user_id: userId },
    });
  }

  async createNotification(data: {
    userId: string;
    projectId: string;
    bugId?: string;
    type: string;
    title: string;
    body?: string;
    severity?: string;
  }) {
    const notification = await this.prisma.userNotification.create({
      data: {
        user_id: data.userId,
        project_id: data.projectId,
        bug_id: data.bugId,
        type: data.type,
        title: data.title,
        body: data.body,
        severity: data.severity,
      },
    });
    this.sse.broadcast(
      {
        event: 'notification:new',
        data: { userId: data.userId, notificationId: notification.id },
      },
      { userId: data.userId },
    );
    return notification;
  }
}
