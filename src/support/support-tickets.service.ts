import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PermissionsService } from '../access-control/access-control.service';
import { UsersService } from '../users/users.service';
import { SupportNotificationsService } from './support-notifications.service';
import { SupportTicketMessage } from './support-ticket-message.entity';
import { SupportTicket } from './support-ticket.entity';
import { SupportQueuesService } from './support-queues.service';
import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_SOURCES,
  SUPPORT_TICKET_STATUSES,
  type CreateSupportTicketInput,
  type CreateSupportTicketMessageInput,
  type SupportTicketCategory,
  type SupportTicketDetailDto,
  type SupportTicketDto,
  type SupportQueueBucketStats,
  type SupportQueueStatsDto,
  type SupportTicketListQuery,
  type SupportTicketQueue,
  type SupportTicketSource,
  type UpdateSupportTicketInput,
} from './support.types';

function labelFor<T extends { value: string; label: string }>(
  options: T[],
  value: string,
): string {
  return options.find((item) => item.value === value)?.label ?? value;
}

function isClosedStatus(status: string): boolean {
  return status === 'resolved' || status === 'closed';
}

@Injectable()
export class SupportTicketsService {
  constructor(
    @InjectRepository(SupportTicket)
    private readonly tickets: Repository<SupportTicket>,
    @InjectRepository(SupportTicketMessage)
    private readonly messages: Repository<SupportTicketMessage>,
    private readonly users: UsersService,
    private readonly permissions: PermissionsService,
    private readonly supportNotifications: SupportNotificationsService,
    private readonly supportQueues: SupportQueuesService,
  ) {}

  private async generateCode(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.tickets.count();
    return `CH-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  private async toDto(
    ticket: SupportTicket,
    messageCount = 0,
    assignedToName: string | null = null,
  ): Promise<SupportTicketDto> {
    if (!assignedToName && ticket.assignedToUserId) {
      const assignee = await this.users.findById(ticket.assignedToUserId);
      assignedToName = assignee?.name ?? null;
    }

    const queueSlug = ticket.queue ?? 'atendimento';
    const queueRow = await this.supportQueues.findBySlug(queueSlug);

    return {
      id: ticket.id,
      code: ticket.code,
      source: ticket.source,
      subject: ticket.subject,
      description: ticket.description,
      category: ticket.category,
      categoryLabel: labelFor(SUPPORT_TICKET_CATEGORIES, ticket.category),
      queue: queueSlug,
      queueLabel: queueRow?.name ?? queueSlug,
      queueColor: queueRow?.color ?? '#64748b',
      priority: ticket.priority,
      priorityLabel: labelFor(SUPPORT_TICKET_PRIORITIES, ticket.priority),
      status: ticket.status,
      statusLabel: labelFor(SUPPORT_TICKET_STATUSES, ticket.status),
      requesterUserId: ticket.requesterUserId,
      requesterName: ticket.requesterName,
      requesterEmail: ticket.requesterEmail,
      companyId: ticket.companyId,
      unitId: ticket.unitId,
      contextUrl: ticket.contextUrl,
      contextLabel: ticket.contextLabel,
      contextMetadata: ticket.contextMetadata,
      assignedToUserId: ticket.assignedToUserId,
      assignedToName,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      closedAt: ticket.closedAt ? ticket.closedAt.toISOString() : null,
      messageCount,
    };
  }

  private async canManageTickets(userId: string): Promise<boolean> {
    return this.permissions.userHasPermission(userId, 'atendimento.chamados.manage');
  }

  private async assertTicketAccess(
    userId: string,
    ticket: SupportTicket,
    source?: SupportTicketSource,
  ): Promise<{ canManage: boolean }> {
    const canManage = await this.canManageTickets(userId);
    const isRequester = ticket.requesterUserId === userId;
    const sourceMatches = !source || ticket.source === source;

    if (canManage) return { canManage: true };
    if (isRequester && sourceMatches) return { canManage: false };

    throw new ForbiddenException('Sem permissão para acessar este chamado.');
  }

  async createTicket(
    requesterUserId: string,
    source: SupportTicketSource,
    input: CreateSupportTicketInput,
  ): Promise<SupportTicketDetailDto> {
    const subject = input.subject?.trim();
    const description = input.description?.trim();
    if (!subject) throw new BadRequestException('Informe o assunto do chamado.');
    if (!description) throw new BadRequestException('Descreva o problema ou solicitação.');

    const requester = await this.users.findById(requesterUserId);
    if (!requester?.active) throw new BadRequestException('Usuário solicitante inválido.');

    const queue = await this.supportQueues.resolveQueueSlug(input.category, input.queue);

    const ticket = this.tickets.create({
      code: await this.generateCode(),
      source,
      subject,
      description,
      category: input.category,
      queue,
      priority: input.priority ?? 'normal',
      status: 'open',
      requesterUserId: requester.id,
      requesterName: requester.name,
      requesterEmail: requester.email,
      companyId: input.companyId ?? null,
      unitId: input.unitId ?? null,
      contextUrl: input.contextUrl?.trim() || null,
      contextLabel: input.contextLabel?.trim() || null,
      contextMetadata: input.contextMetadata ?? null,
      assignedToUserId: null,
      closedAt: null,
    });

    const saved = await this.tickets.save(ticket);
    await this.supportNotifications.onTicketCreated(saved, requesterUserId);
    const dto = await this.toDto(saved, 0);
    return { ...dto, messages: [] };
  }

  private async messageCountsByTicketId(ticketIds: string[]): Promise<Map<string, number>> {
    if (!ticketIds.length) return new Map();

    const rows = await this.messages
      .createQueryBuilder('message')
      .select('message.ticketId', 'ticketId')
      .addSelect('COUNT(*)', 'count')
      .where('message.ticketId IN (:...ticketIds)', { ticketIds })
      .groupBy('message.ticketId')
      .getRawMany<{ ticketId: string; count: string }>();

    return new Map(rows.map((row) => [row.ticketId, Number(row.count) || 0]));
  }

  private applyListFilters(
    qb: ReturnType<Repository<SupportTicket>['createQueryBuilder']>,
    userId: string,
    routeSource: SupportTicketSource | undefined,
    query: SupportTicketListQuery,
    mineOnly: boolean,
  ): void {
    if (routeSource) qb.andWhere('ticket.source = :routeSource', { routeSource });
    if (mineOnly) qb.andWhere('ticket.requesterUserId = :userId', { userId });
    if (query.queue) qb.andWhere('ticket.queue = :queue', { queue: query.queue });
    if (query.status) qb.andWhere('ticket.status = :status', { status: query.status });
    if (query.priority) qb.andWhere('ticket.priority = :priority', { priority: query.priority });
    if (query.source) qb.andWhere('ticket.source = :filterSource', { filterSource: query.source });
    if (query.assignedToMe) qb.andWhere('ticket.assignedToUserId = :userId', { userId });
    if (query.openOnly) {
      qb.andWhere('ticket.status NOT IN (:...closedStatuses)', {
        closedStatuses: ['resolved', 'closed'],
      });
    }

    const q = query.q?.trim();
    if (q) {
      qb.andWhere(
        '(ticket.code LIKE :q OR ticket.subject LIKE :q OR ticket.requesterName LIKE :q OR ticket.requesterEmail LIKE :q)',
        { q: `%${q}%` },
      );
    }
  }

  async listTickets(
    userId: string,
    source: SupportTicketSource | undefined,
    query: SupportTicketListQuery,
  ): Promise<{ items: SupportTicketDto[]; total: number }> {
    const canManage = await this.canManageTickets(userId);
    const mineOnly = query.mineOnly !== false && !canManage;

    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const offset = Math.max(query.offset ?? 0, 0);

    const qb = this.tickets.createQueryBuilder('ticket');
    this.applyListFilters(qb, userId, source, query, mineOnly);

    const sort = query.sort ?? 'updatedAt';
    if (sort === 'priority') {
      qb.orderBy("FIELD(ticket.priority, 'urgent', 'high', 'normal', 'low')", 'ASC');
      qb.addOrderBy('ticket.updatedAt', 'DESC');
    } else if (sort === 'createdAt') {
      qb.orderBy('ticket.createdAt', 'DESC');
    } else {
      qb.orderBy('ticket.updatedAt', 'DESC');
    }

    qb.take(limit).skip(offset);

    const [rows, total] = await qb.getManyAndCount();
    const messageCounts = await this.messageCountsByTicketId(rows.map((row) => row.id));

    const items = await Promise.all(
      rows.map((row) => this.toDto(row, messageCounts.get(row.id) ?? 0)),
    );

    return { items, total };
  }

  async getQueueStats(
    userId: string,
    queue?: SupportTicketQueue,
  ): Promise<SupportQueueStatsDto> {
    const canManage = await this.canManageTickets(userId);
    const mineOnly = !canManage;

    const base = this.tickets.createQueryBuilder('ticket');
    if (mineOnly) base.andWhere('ticket.requesterUserId = :userId', { userId });

    const bucketFor = async (
      bucketQueue?: SupportTicketQueue,
    ): Promise<SupportQueueBucketStats> => {
      const countWhere = async (
        extra: (qb: ReturnType<Repository<SupportTicket>['createQueryBuilder']>) => void,
      ) => {
        const qb = base.clone();
        if (bucketQueue) qb.andWhere('ticket.queue = :bucketQueue', { bucketQueue });
        extra(qb);
        return qb.getCount();
      };

      const [total, open, inProgress, waitingRequester, urgent] = await Promise.all([
        countWhere(() => undefined),
        countWhere((qb) => qb.andWhere('ticket.status = :status', { status: 'open' })),
        countWhere((qb) => qb.andWhere('ticket.status = :status', { status: 'in_progress' })),
        countWhere((qb) =>
          qb.andWhere('ticket.status = :status', { status: 'waiting_requester' }),
        ),
        countWhere((qb) =>
          qb.andWhere('ticket.priority = :priority', { priority: 'urgent' }).andWhere(
            'ticket.status NOT IN (:...closedStatuses)',
            { closedStatuses: ['resolved', 'closed'] },
          ),
        ),
      ]);

      return { total, open, inProgress, waitingRequester, urgent };
    };

    const slugs = await this.supportQueues.listSlugsForStats();
    const bucketResults = await Promise.all(slugs.map((slug) => bucketFor(slug)));
    const byQueue = Object.fromEntries(slugs.map((slug, index) => [slug, bucketResults[index]]));

    const assignedToMe = canManage
      ? await (async () => {
          const qb = base.clone();
          if (queue) qb.andWhere('ticket.queue = :queue', { queue });
          qb.andWhere('ticket.assignedToUserId = :userId', { userId });
          return qb.getCount();
        })()
      : 0;

    const activeBucket = queue
      ? byQueue[queue] ?? (await bucketFor(queue))
      : bucketResults.reduce(
          (acc, bucket) => ({
            total: acc.total + bucket.total,
            open: acc.open + bucket.open,
            inProgress: acc.inProgress + bucket.inProgress,
            waitingRequester: acc.waitingRequester + bucket.waitingRequester,
            urgent: acc.urgent + bucket.urgent,
          }),
          { total: 0, open: 0, inProgress: 0, waitingRequester: 0, urgent: 0 },
        );

    return {
      ...activeBucket,
      assignedToMe,
      byQueue,
    };
  }

  async getTicket(
    userId: string,
    ticketId: string,
    source?: SupportTicketSource,
  ): Promise<SupportTicketDetailDto> {
    const ticket = await this.tickets.findOne({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Chamado não encontrado.');

    const access = await this.assertTicketAccess(userId, ticket, source);
    const messageRows = await this.messages.find({
      where: { ticketId: ticket.id },
      order: { createdAt: 'ASC' },
    });

    const visibleMessages = access.canManage
      ? messageRows
      : messageRows.filter((row) => !row.isInternal);

    const dto = await this.toDto(ticket, visibleMessages.length);
    return {
      ...dto,
      messages: visibleMessages.map((row) => ({
        id: row.id,
        ticketId: row.ticketId,
        authorUserId: row.authorUserId,
        authorName: row.authorName,
        body: row.body,
        isInternal: row.isInternal,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async addMessage(
    userId: string,
    ticketId: string,
    input: CreateSupportTicketMessageInput,
    source?: SupportTicketSource,
  ): Promise<SupportTicketDetailDto> {
    const body = input.body?.trim();
    if (!body) throw new BadRequestException('Informe a mensagem.');

    const ticket = await this.tickets.findOne({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Chamado não encontrado.');

    const access = await this.assertTicketAccess(userId, ticket, source);
    if (isClosedStatus(ticket.status)) {
      throw new BadRequestException('Este chamado já foi encerrado.');
    }

    const author = await this.users.findById(userId);
    if (!author?.active) throw new BadRequestException('Usuário inválido.');

    const isInternal = Boolean(input.isInternal);
    if (isInternal && !access.canManage) {
      throw new ForbiddenException('Apenas a equipe de atendimento pode registrar notas internas.');
    }

    await this.messages.save(
      this.messages.create({
        ticketId: ticket.id,
        authorUserId: author.id,
        authorName: author.name,
        body,
        isInternal,
      }),
    );

    if (!access.canManage && ticket.status === 'waiting_requester') {
      ticket.status = 'in_progress';
      await this.tickets.save(ticket);
    }

    await this.supportNotifications.onTicketMessage({
      ticket,
      authorUserId: author.id,
      authorName: author.name,
      body,
      isInternal,
      fromStaff: access.canManage,
    });

    return this.getTicket(userId, ticketId, source);
  }

  async updateTicket(
    userId: string,
    ticketId: string,
    input: UpdateSupportTicketInput,
  ): Promise<SupportTicketDetailDto> {
    const canManage = await this.canManageTickets(userId);
    if (!canManage) throw new ForbiddenException('Sem permissão para gerenciar chamados.');

    const ticket = await this.tickets.findOne({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Chamado não encontrado.');

    const previousStatus = ticket.status;
    const previousAssignee = ticket.assignedToUserId;

    if (input.priority) ticket.priority = input.priority;
    if (input.queue) {
      const queue = await this.supportQueues.assertActiveSlug(input.queue);
      ticket.queue = queue.slug;
    }

    if (input.assignedToUserId !== undefined) {
      if (input.assignedToUserId) {
        const assignee = await this.users.findById(input.assignedToUserId);
        if (!assignee?.active) throw new BadRequestException('Responsável inválido.');
      }
      ticket.assignedToUserId = input.assignedToUserId;
    }

    if (input.status) {
      ticket.status = input.status;
      ticket.closedAt = isClosedStatus(input.status) ? new Date() : null;
      if (input.status === 'in_progress' && !ticket.assignedToUserId) {
        ticket.assignedToUserId = userId;
      }
    }

    await this.tickets.save(ticket);

    await this.supportNotifications.onTicketUpdated({
      ticket,
      actorUserId: userId,
      previousStatus,
      previousAssignee,
      statusChanged: input.status !== undefined && input.status !== previousStatus,
      assigneeChanged:
        input.assignedToUserId !== undefined &&
        input.assignedToUserId !== previousAssignee,
    });

    return this.getTicket(userId, ticketId);
  }

  async getCatalog() {
    const queues = await this.supportQueues.listCatalog();
    return {
      categories: SUPPORT_TICKET_CATEGORIES,
      priorities: SUPPORT_TICKET_PRIORITIES,
      statuses: SUPPORT_TICKET_STATUSES,
      sources: SUPPORT_TICKET_SOURCES,
      queues,
    };
  }
}
