import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Notification } from './notification.entity';
import { NotificationTriggersRegistry } from './notification-triggers.registry';
import type {
  NotificationDto,
  NotificationListQuery,
  NotificationSummaryDto,
  NotificationTriggerEvent,
  NotifyUsersInput,
} from './notification.types';

function toDto(row: Notification): NotificationDto {
  return {
    id: row.id,
    userId: row.userId,
    triggerKey: row.triggerKey,
    title: row.title,
    body: row.body,
    severity: row.severity,
    entityType: row.entityType,
    entityId: row.entityId,
    actionUrl: row.actionUrl,
    metadata: row.metadata,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    private readonly triggers: NotificationTriggersRegistry,
  ) {}

  /**
   * Ponto central para criar notificações sistêmicas.
   * Outros módulos devem preferir este método em vez de gravar na entidade diretamente.
   */
  async notify(input: NotifyUsersInput): Promise<NotificationDto[]> {
    const userIds = [...new Set(input.userIds.filter(Boolean))];
    if (!userIds.length) return [];

    const rows = userIds.map((userId) =>
      this.notifications.create({
        userId,
        triggerKey: input.triggerKey,
        title: input.title.trim(),
        body: input.body.trim(),
        severity: input.severity ?? 'info',
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        actionUrl: input.actionUrl ?? null,
        metadata: input.metadata ?? null,
        readAt: null,
      }),
    );

    const saved = await this.notifications.save(rows);
    return saved.map(toDto);
  }

  async dispatchTriggerEvent(event: NotificationTriggerEvent): Promise<void> {
    await this.triggers.dispatch(event);
  }

  async listForUser(userId: string, query: NotificationListQuery = {}): Promise<NotificationSummaryDto> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const offset = Math.max(query.offset ?? 0, 0);

    const where = query.unreadOnly
      ? { userId, readAt: IsNull() }
      : { userId };

    const [items, unreadCount] = await Promise.all([
      this.notifications.find({
        where,
        order: { createdAt: 'DESC' },
        take: limit,
        skip: offset,
      }),
      this.notifications.count({ where: { userId, readAt: IsNull() } }),
    ]);

    return {
      unreadCount,
      items: items.map(toDto),
    };
  }

  async countUnread(userId: string): Promise<number> {
    return this.notifications.count({ where: { userId, readAt: IsNull() } });
  }

  async markRead(userId: string, notificationId: string): Promise<NotificationDto> {
    const row = await this.notifications.findOne({ where: { id: notificationId, userId } });
    if (!row) throw new NotFoundException('Notificação não encontrada.');

    if (!row.readAt) {
      row.readAt = new Date();
      await this.notifications.save(row);
    }

    return toDto(row);
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.notifications.update(
      { userId, readAt: IsNull() },
      { readAt: new Date() },
    );

    return { updated: result.affected ?? 0 };
  }

  async markManyRead(userId: string, notificationIds: string[]): Promise<{ updated: number }> {
    const ids = [...new Set(notificationIds.filter(Boolean))];
    if (!ids.length) return { updated: 0 };

    const result = await this.notifications.update(
      { userId, id: In(ids), readAt: IsNull() },
      { readAt: new Date() },
    );

    return { updated: result.affected ?? 0 };
  }
}
