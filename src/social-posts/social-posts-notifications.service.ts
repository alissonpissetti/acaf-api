import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { SocialPost } from './social-post.entity';

function postLabel(post: SocialPost): string {
  const title = post.titulo?.trim() || 'Post';
  return post.codigo?.trim() ? `${post.codigo} — ${title}` : title;
}

@Injectable()
export class SocialPostsNotificationsService {
  private readonly logger = new Logger(SocialPostsNotificationsService.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly users: UsersService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  private postUrl(postId: string): string {
    return `/m/marketing/redes-sociais?post=${encodeURIComponent(postId)}`;
  }

  private async filterNotifiableUserIds(userIds: string[]): Promise<string[]> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (!unique.length) return [];

    const rows = await this.userRepo.find({
      where: { id: In(unique), active: true },
      select: ['id'],
    });

    return rows.map((row) => row.id);
  }

  private async notifySafely(input: Parameters<NotificationsService['notify']>[0]): Promise<void> {
    try {
      const userIds = await this.filterNotifiableUserIds(input.userIds);
      if (!userIds.length) return;
      await this.notifications.notify({ ...input, userIds });
    } catch (error) {
      this.logger.warn(
        `Falha ao enviar notificação (${input.triggerKey}): ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private async actorName(actorUserId: string): Promise<string> {
    const user = await this.users.findById(actorUserId);
    return user?.name?.trim() || 'Alguém';
  }

  async onResponsavelChanged(
    post: SocialPost,
    previousResponsavelUserId: string | null,
    actorUserId: string,
  ): Promise<void> {
    const next = post.responsavelUserId?.trim() || null;
    if (!next || next === previousResponsavelUserId || next === actorUserId) return;

    const actor = await this.actorName(actorUserId);
    const label = postLabel(post);

    await this.notifySafely({
      userIds: [next],
      triggerKey: 'marketing.social.post.assigned',
      title: 'Você foi definido como responsável',
      body: `${actor} atribuiu você como responsável no post “${label}”.`,
      severity: 'info',
      entityType: 'social_post',
      entityId: post.id,
      actionUrl: this.postUrl(post.id),
      metadata: { postId: post.id, actorUserId },
    });
  }
}