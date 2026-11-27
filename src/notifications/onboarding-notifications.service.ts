import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PermissionsService } from '../access-control/access-control.service';
import { User } from '../users/user.entity';
import { NotificationsService } from './notifications.service';

@Injectable()
export class OnboardingNotificationsService {
  private readonly logger = new Logger(OnboardingNotificationsService.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly permissions: PermissionsService,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  private partnerNetworkUrl(networkId: string): string {
    return `/m/operacao/redes?id=${encodeURIComponent(networkId)}`;
  }

  private companyUrl(companyId: string): string {
    return `/m/corporativo/empresas?id=${encodeURIComponent(companyId)}`;
  }

  private async filterActiveUserIds(userIds: string[]): Promise<string[]> {
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
      const userIds = await this.filterActiveUserIds(input.userIds);
      if (!userIds.length) return;
      await this.notifications.notify({ ...input, userIds });
    } catch (error) {
      this.logger.warn(
        `Falha ao enviar notificação (${input.triggerKey}): ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /** Academia parceira concluiu o cadastro inicial no portal (convite de onboarding). */
  async onPartnerOnboardingCompleted(input: {
    networkId: string;
    networkName: string;
    userName: string;
    userEmail: string;
  }): Promise<void> {
    const staffIds = await this.permissions.listUserIdsWithPermission('operacao.redes');
    if (!staffIds.length) return;

    const name = input.userName?.trim() || 'Responsável';
    const email = input.userEmail?.trim() || '';
    await this.notifySafely({
      userIds: staffIds,
      triggerKey: 'operacao.partner.onboarding.completed',
      title: 'Academia concluiu o onboarding',
      body: `${input.networkName}: ${name}${email ? ` (${email})` : ''} finalizou o cadastro inicial no portal parceiro.`,
      severity: 'success',
      entityType: 'network',
      entityId: input.networkId,
      actionUrl: this.partnerNetworkUrl(input.networkId),
      metadata: {
        networkId: input.networkId,
        networkName: input.networkName,
        userName: name,
        userEmail: email || null,
      },
    });
  }

  /** Empresa concluiu o cadastro do gestor no portal corporativo. */
  async onCorporateOnboardingCompleted(input: {
    companyId: string;
    companyName: string;
    managerName: string;
    managerEmail: string;
  }): Promise<void> {
    const staffIds = await this.permissions.listUserIdsWithPermission('corporativo.empresas');
    if (!staffIds.length) return;

    const name = input.managerName?.trim() || 'Gestor';
    const email = input.managerEmail?.trim() || '';
    await this.notifySafely({
      userIds: staffIds,
      triggerKey: 'corporativo.company.onboarding.completed',
      title: 'Empresa concluiu o onboarding',
      body: `${input.companyName}: ${name}${email ? ` (${email})` : ''} finalizou o cadastro no portal corporativo.`,
      severity: 'success',
      entityType: 'company',
      entityId: input.companyId,
      actionUrl: this.companyUrl(input.companyId),
      metadata: {
        companyId: input.companyId,
        companyName: input.companyName,
        managerName: name,
        managerEmail: email || null,
      },
    });
  }
}