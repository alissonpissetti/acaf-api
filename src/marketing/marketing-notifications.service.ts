import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PermissionsService } from '../access-control/access-control.service';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../users/user.entity';

function excerpt(text: string, max = 140): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

@Injectable()
export class MarketingNotificationsService {
  private readonly logger = new Logger(MarketingNotificationsService.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly permissions: PermissionsService,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  private leadUrl(leadId: string): string {
    return `/m/comercial/leads?leadId=${encodeURIComponent(leadId)}`;
  }

  private async marketingStaffUserIds(excludeUserIds: string[] = []): Promise<string[]> {
    const exclude = new Set(excludeUserIds.filter(Boolean));
    const [formIds, panelIds] = await Promise.all([
      this.permissions.listUserIdsWithPermission('marketing.formularios'),
      this.permissions.listUserIdsWithPermission('marketing.painel'),
    ]);
    return [...new Set([...formIds, ...panelIds])].filter((id) => !exclude.has(id));
  }

  private async filterNotifiableUserIds(userIds: string[]): Promise<string[]> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (!unique.length) return [];

    const rows = await this.users.find({
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

  async onMarketingFormLeadCreated(input: {
    leadId: string;
    leadTitle: string;
    formName: string;
    formSlug: string;
    ownerUserId?: string | null;
  }): Promise<void> {
    const staffIds = await this.marketingStaffUserIds([input.ownerUserId ?? ''].filter(Boolean));
    const recipientIds = [...new Set([...(input.ownerUserId ? [input.ownerUserId] : []), ...staffIds])];
    if (!recipientIds.length) return;

    const contactHint = excerpt(input.leadTitle, 80);
    await this.notifySafely({
      userIds: recipientIds,
      triggerKey: 'marketing.lead.created',
      title: 'Novo lead de formulário',
      body: `"${input.formName}" gerou um lead${contactHint ? `: ${contactHint}` : ''}.`,
      severity: 'success',
      entityType: 'commercial_lead',
      entityId: input.leadId,
      actionUrl: this.leadUrl(input.leadId),
      metadata: {
        formSlug: input.formSlug,
        formName: input.formName,
      },
    });
  }
}
