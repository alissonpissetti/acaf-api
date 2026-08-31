import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PermissionsService } from '../access-control/access-control.service';
import { NotificationsService } from '../notifications/notifications.service';
import { User, userHasRole, UserRole } from '../users/user.entity';
import { SupportTicket } from './support-ticket.entity';
import {
  SUPPORT_TICKET_STATUSES,
  type SupportTicketStatus,
} from './support.types';

function labelForStatus(status: SupportTicketStatus): string {
  return SUPPORT_TICKET_STATUSES.find((item) => item.value === status)?.label ?? status;
}

function excerpt(text: string, max = 140): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

@Injectable()
export class SupportNotificationsService {
  private readonly logger = new Logger(SupportNotificationsService.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly permissions: PermissionsService,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  private adminTicketUrl(ticketId: string): string {
    return `/m/atendimento/chamados?id=${ticketId}`;
  }

  private requesterTicketUrl(ticket: SupportTicket): string {
    if (ticket.source === 'partner' || ticket.source === 'corporate') {
      return `/atendimento?id=${ticket.id}`;
    }
    return this.adminTicketUrl(ticket.id);
  }

  private async staffUserIds(excludeUserIds: string[] = []): Promise<string[]> {
    const exclude = new Set(excludeUserIds.filter(Boolean));
    const ids = await this.permissions.listUserIdsWithPermission('atendimento.chamados.manage');
    return ids.filter((id) => !exclude.has(id));
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

  async onTicketCreated(ticket: SupportTicket, actorUserId: string): Promise<void> {
    const staffIds = await this.staffUserIds([actorUserId]);
    const severity =
      ticket.priority === 'urgent' ? 'error' : ticket.priority === 'high' ? 'warning' : 'info';

    await this.notifySafely({
      userIds: staffIds,
      triggerKey: 'support.ticket.created',
      title: `Novo chamado ${ticket.code}`,
      body: `${ticket.requesterName} abriu “${ticket.subject}”.`,
      severity,
      entityType: 'support_ticket',
      entityId: ticket.id,
      actionUrl: this.adminTicketUrl(ticket.id),
      metadata: {
        ticketCode: ticket.code,
        source: ticket.source,
        requesterUserId: ticket.requesterUserId,
      },
    });
  }

  async onTicketMessage(input: {
    ticket: SupportTicket;
    authorUserId: string;
    authorName: string;
    body: string;
    isInternal: boolean;
    fromStaff: boolean;
  }): Promise<void> {
    const preview = excerpt(input.body);

    if (input.isInternal) {
      const staffIds = await this.staffUserIds([input.authorUserId]);
      await this.notifySafely({
        userIds: staffIds,
        triggerKey: 'support.ticket.internal_note',
        title: `Nota interna · ${input.ticket.code}`,
        body: `${input.authorName}: ${preview}`,
        severity: 'info',
        entityType: 'support_ticket',
        entityId: input.ticket.id,
        actionUrl: this.adminTicketUrl(input.ticket.id),
        metadata: { ticketCode: input.ticket.code, internal: true },
      });
      return;
    }

    if (input.fromStaff) {
      await this.notifySafely({
        userIds: [input.ticket.requesterUserId],
        triggerKey: 'support.ticket.message',
        title: `Resposta no chamado ${input.ticket.code}`,
        body: `${input.authorName}: ${preview}`,
        severity: 'info',
        entityType: 'support_ticket',
        entityId: input.ticket.id,
        actionUrl: this.requesterTicketUrl(input.ticket),
        metadata: { ticketCode: input.ticket.code, fromStaff: true },
      });
      return;
    }

    const staffIds = await this.staffUserIds([input.authorUserId]);
    const recipients = new Set(staffIds);
    if (input.ticket.assignedToUserId && input.ticket.assignedToUserId !== input.authorUserId) {
      recipients.add(input.ticket.assignedToUserId);
    }

    await this.notifySafely({
      userIds: [...recipients],
      triggerKey: 'support.ticket.message',
      title: `Nova resposta · ${input.ticket.code}`,
      body: `${input.authorName}: ${preview}`,
      severity: 'info',
      entityType: 'support_ticket',
      entityId: input.ticket.id,
      actionUrl: this.adminTicketUrl(input.ticket.id),
      metadata: { ticketCode: input.ticket.code, fromStaff: false },
    });
  }

  async onTicketUpdated(input: {
    ticket: SupportTicket;
    actorUserId: string;
    previousStatus: SupportTicketStatus;
    previousAssignee: string | null;
    statusChanged: boolean;
    assigneeChanged: boolean;
  }): Promise<void> {
    const { ticket, actorUserId, previousStatus, previousAssignee } = input;

    if (input.assigneeChanged && ticket.assignedToUserId && ticket.assignedToUserId !== actorUserId) {
      await this.notifySafely({
        userIds: [ticket.assignedToUserId],
        triggerKey: 'support.ticket.assigned',
        title: `Chamado atribuído · ${ticket.code}`,
        body: `Você foi definido como responsável por “${ticket.subject}”.`,
        severity: 'info',
        entityType: 'support_ticket',
        entityId: ticket.id,
        actionUrl: this.adminTicketUrl(ticket.id),
        metadata: {
          ticketCode: ticket.code,
          previousAssignee,
          assignedToUserId: ticket.assignedToUserId,
        },
      });
    }

    if (!input.statusChanged || ticket.status === previousStatus) return;

    const statusLabel = labelForStatus(ticket.status);

    if (ticket.status === 'waiting_requester') {
      await this.notifySafely({
        userIds: [ticket.requesterUserId],
        triggerKey: 'support.ticket.status',
        title: `Aguardando você · ${ticket.code}`,
        body: `O chamado “${ticket.subject}” precisa da sua resposta.`,
        severity: 'warning',
        entityType: 'support_ticket',
        entityId: ticket.id,
        actionUrl: this.requesterTicketUrl(ticket),
        metadata: { ticketCode: ticket.code, status: ticket.status },
      });
      return;
    }

    if (ticket.status === 'resolved' || ticket.status === 'closed') {
      await this.notifySafely({
        userIds: [ticket.requesterUserId],
        triggerKey: 'support.ticket.status',
        title: `Chamado ${statusLabel.toLowerCase()} · ${ticket.code}`,
        body: `“${ticket.subject}” foi marcado como ${statusLabel.toLowerCase()}.`,
        severity: ticket.status === 'resolved' ? 'success' : 'info',
        entityType: 'support_ticket',
        entityId: ticket.id,
        actionUrl: this.requesterTicketUrl(ticket),
        metadata: { ticketCode: ticket.code, status: ticket.status },
      });
      return;
    }

    if (ticket.requesterUserId !== actorUserId) {
      const actor = await this.users.findOne({
        where: { id: actorUserId },
        select: ['id', 'name', 'roles'],
      });
      const actorIsStaff = actor ? userHasRole(actor, UserRole.ADMIN) : false;
      if (actorIsStaff) {
        await this.notifySafely({
          userIds: [ticket.requesterUserId],
          triggerKey: 'support.ticket.status',
          title: `Atualização · ${ticket.code}`,
          body: `Seu chamado “${ticket.subject}” está ${statusLabel.toLowerCase()}.`,
          severity: 'info',
          entityType: 'support_ticket',
          entityId: ticket.id,
          actionUrl: this.requesterTicketUrl(ticket),
          metadata: { ticketCode: ticket.code, status: ticket.status },
        });
      }
    }
  }
}
