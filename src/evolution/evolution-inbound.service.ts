import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole, userHasRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { EvolutionInstance } from './evolution-instance.entity';
import { EvolutionInboxService, type ParsedEvolutionMessage } from './evolution-inbox.service';
import {
  collectEvolutionMessageRows,
  parseEvolutionMessagePayload,
} from './evolution-message.parser';
import {
  isEvolutionChatWebhookEvent,
  isEvolutionContactWebhookEvent,
  isEvolutionGroupWebhookEvent,
  isEvolutionMessageWebhookEvent,
} from './evolution-webhook.constants';

type EvolutionWebhookBody = {
  event?: string;
  instance?: string;
  instanceName?: string;
  data?: unknown;
  [key: string]: unknown;
};

@Injectable()
export class EvolutionInboundService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(EvolutionInstance)
    private readonly instances: Repository<EvolutionInstance>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly usersService: UsersService,
    private readonly inbox: EvolutionInboxService,
  ) {}

  assertWebhookAuthorized(secretHeader?: string) {
    const secret = this.config.get<string>('EVOLUTION_WEBHOOK_SECRET')?.trim();
    if (!secret) return;
    if (secretHeader?.trim() !== secret) {
      throw new ForbiddenException('Webhook não autorizado.');
    }
  }

  async ingestMessagePayload(
    instanceId: string,
    data: unknown,
  ): Promise<{ imported: number; total: number }> {
    const instance = await this.instances.findOne({
      where: { id: instanceId, active: true },
      select: [
        'id',
        'name',
        'instanceKey',
        'baseUrl',
        'apiKey',
        'autoCreateLeads',
        'defaultOwnerUserId',
        'connectionState',
      ],
    });
    if (!instance) throw new NotFoundException('Instância não encontrada.');

    const parsed = parseEvolutionMessagePayload(data);
    const ownerUserId = await this.resolveOwnerUserId(instance);
    let imported = 0;
    for (const message of parsed) {
      const outcome = await this.inbox.ingestFromInstance(instance, {
        ownerUserId,
        parsed: message,
      });
      if (outcome.ingested) imported += 1;
    }
    return { imported, total: parsed.length };
  }

  async handleWebhook(body: EvolutionWebhookBody) {
    const event = String(body.event ?? '').toLowerCase();
    const dataRecord =
      body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : null;
    const instanceKey = String(
      body.instance ??
        body.instanceName ??
        dataRecord?.instance ??
        dataRecord?.instanceName ??
        '',
    ).trim();
    if (!instanceKey) return { ok: true, ignored: 'sem instância' };

    const instance = await this.instances.findOne({
      where: { instanceKey, active: true },
      select: [
        'id',
        'name',
        'instanceKey',
        'baseUrl',
        'apiKey',
        'autoCreateLeads',
        'defaultOwnerUserId',
        'connectionState',
      ],
    });

    if (!instance) return { ok: true, ignored: 'instância não cadastrada' };

    if (event.includes('connection')) {
      await this.applyConnectionState(instance, body.data);
      return { ok: true, kind: 'connection' };
    }

    if (isEvolutionChatWebhookEvent(event)) {
      const updated = await this.inbox.applyChatsSyncFromWebhook(instance.id, body.data ?? body);
      return { ok: true, kind: 'chats', updated };
    }

    if (isEvolutionGroupWebhookEvent(event)) {
      void this.inbox.backfillGroupThreadNames(instance.id).catch(() => {});
      return { ok: true, kind: 'groups' };
    }

    if (isEvolutionContactWebhookEvent(event)) {
      void this.inbox
        .applyPushNamesFromPayload(instance.id, body.data ?? body)
        .catch(() => {});
      return { ok: true, kind: 'contacts' };
    }

    let messageSource: unknown = body.data ?? body;
    if (!collectEvolutionMessageRows(messageSource).length) {
      messageSource = body;
    }
    const hasMessagePayload =
      collectEvolutionMessageRows(messageSource).length > 0 ||
      collectEvolutionMessageRows(body).length > 0;

    if (!isEvolutionMessageWebhookEvent(event) && !hasMessagePayload) {
      return { ok: true, kind: 'event', event: body.event ?? event };
    }

    let messages = parseEvolutionMessagePayload(messageSource);
    if (!messages.length && collectEvolutionMessageRows(body).length) {
      messages = parseEvolutionMessagePayload(body);
    }
    if (!messages.length) {
      return { ok: true, kind: 'messages', ignored: 'sem mensagens parseáveis', event: body.event ?? event };
    }
    await this.inbox.backfillMessageMediaFromPayload(instance.id, messageSource);
    await this.inbox.applyPushNamesFromPayload(instance.id, messageSource).catch(() => {});
    const ownerUserId = await this.resolveOwnerUserId(instance);
    const results: Array<{
      leadId: string | null;
      created: boolean;
      messageId: string | null;
      ingested: boolean;
    }> = [];

    for (const parsed of messages) {
      const outcome = await this.inbox.ingestFromInstance(instance, {
        ownerUserId,
        parsed,
      });
      results.push(outcome);
    }

    return { ok: true, kind: 'messages', results };
  }

  private async applyConnectionState(instance: EvolutionInstance, data: unknown) {
    const state = this.readConnectionState(data);
    if (!state) return;
    const previous = String(instance.connectionState ?? '')
      .trim()
      .toLowerCase();
    instance.connectionState = state;
    const phone = this.readConnectedPhone(data);
    if (phone) instance.connectedPhone = phone;
    await this.instances.save(instance);
    const normalized = state.toLowerCase();
    if (this.isWhatsAppSessionOpen(normalized) && !this.isWhatsAppSessionOpen(previous)) {
      this.inbox.queueInboxBootstrapAfterConnect(instance.id, { force: true });
    }
  }

  private isWhatsAppSessionOpen(state: string): boolean {
    return state === 'open' || state === 'connected' || state === 'online';
  }

  private readConnectionState(data: unknown): string | null {
    if (!data || typeof data !== 'object') return null;
    const row = data as Record<string, unknown>;
    const state = row.state ?? row.status ?? (row.instance as Record<string, unknown> | undefined)?.state;
    return state ? String(state).toLowerCase() : null;
  }

  private readConnectedPhone(data: unknown): string | null {
    if (!data || typeof data !== 'object') return null;
    const row = data as Record<string, unknown>;
    const raw =
      row.owner ??
      row.number ??
      (row.instance as Record<string, unknown> | undefined)?.owner ??
      (row.instance as Record<string, unknown> | undefined)?.number;
    if (!raw) return null;
    const digits = String(raw).replace(/\D/g, '');
    if (digits.length >= 12 && digits.startsWith('55')) return `+${digits}`;
    if (digits.length >= 10) return `+55${digits}`;
    return null;
  }

  private async resolveOwnerUserId(instance: EvolutionInstance): Promise<string> {
    if (instance.defaultOwnerUserId) {
      const user = await this.usersService.findById(instance.defaultOwnerUserId);
      if (user?.active) return user.id;
    }

    const rows = await this.users.find({ order: { createdAt: 'ASC' } });
    const admin = rows.find((user) => user.active && userHasRole(user, UserRole.ADMIN));
    if (admin) return admin.id;

    if (rows[0]) return rows[0].id;
    throw new Error('Nenhum usuário disponível para atribuir o lead.');
  }
}
