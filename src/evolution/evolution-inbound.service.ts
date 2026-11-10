import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole, userHasRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { isValidMobilePhone, normalizeMobilePhone } from '../users/person.utils';
import { EvolutionInstance } from './evolution-instance.entity';
import { EvolutionInboxService, type ParsedEvolutionMessage } from './evolution-inbox.service';
import { isEvolutionMessageWebhookEvent } from './evolution-webhook.constants';

type EvolutionWebhookBody = {
  event?: string;
  instance?: string;
  instanceName?: string;
  data?: unknown;
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

  assertWebhookAuthorized(headerKey?: string) {
    const secret = this.config.get<string>('EVOLUTION_WEBHOOK_SECRET')?.trim();
    if (!secret) return;
    if (headerKey?.trim() !== secret) {
      throw new ForbiddenException('Webhook não autorizado.');
    }
  }

  async handleWebhook(body: EvolutionWebhookBody) {
    const event = String(body.event ?? '').toLowerCase();
    const instanceKey = String(body.instance ?? body.instanceName ?? '').trim();
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

    if (!isEvolutionMessageWebhookEvent(event)) {
      return { ok: true, ignored: event || 'evento não tratado' };
    }

    const messages = this.extractMessages(body.data);
    const ownerUserId = await this.resolveOwnerUserId(instance);
    const results: Array<{ leadId: string | null; created: boolean; messageId: string | null }> =
      [];

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
    instance.connectionState = state;
    const phone = this.readConnectedPhone(data);
    if (phone) instance.connectedPhone = phone;
    await this.instances.save(instance);
  }

  private collectMessageRows(data: unknown): unknown[] {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (typeof data !== 'object') return [];
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.messages)) return record.messages;
    if (record.key || record.message) return [data];
    return [];
  }

  private messageTimestamp(item: Record<string, unknown>, key: Record<string, unknown>): Date {
    const raw =
      item.messageTimestamp ??
      key.messageTimestamp ??
      item.timestamp ??
      (item.message as Record<string, unknown> | undefined)?.messageTimestamp;
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(num) && num > 0) {
      const ms = num > 1e12 ? num : num * 1000;
      return new Date(ms);
    }
    return new Date();
  }

  private messageText(message: Record<string, unknown>): string {
    const extended = message.extendedTextMessage as Record<string, unknown> | undefined;
    const image = message.imageMessage as Record<string, unknown> | undefined;
    const video = message.videoMessage as Record<string, unknown> | undefined;
    const audio = message.audioMessage as Record<string, unknown> | undefined;
    const document = message.documentMessage as Record<string, unknown> | undefined;

    const candidates = [
      message.conversation,
      extended?.text,
      image?.caption,
      video?.caption,
      document?.caption,
      image ? '[imagem]' : null,
      video ? '[vídeo]' : null,
      audio ? '[áudio]' : null,
      document ? '[documento]' : null,
      message.stickerMessage ? '[figurinha]' : null,
    ];

    for (const item of candidates) {
      const text = String(item ?? '').trim();
      if (text) return text;
    }

    return '(mensagem)';
  }

  private extractMessages(data: unknown): ParsedEvolutionMessage[] {
    const rows = this.collectMessageRows(data);
    const output: ParsedEvolutionMessage[] = [];

    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const item = row as Record<string, unknown>;
      const key = (item.key ?? {}) as Record<string, unknown>;
      const fromMe = Boolean(key.fromMe);
      const jid = String(key.remoteJid ?? key.remoteJidAlt ?? key.participant ?? '');
      const isGroup = jid.includes('@g.us') || jid.includes('@broadcast');
      const phone = isGroup ? null : this.phoneFromJid(jid);
      const externalId = String(
        key.id ?? item.id ?? `${jid}-${this.messageTimestamp(item, key).getTime()}`,
      );
      const pushName = String(item.pushName ?? item.verifiedBizName ?? '').trim() || undefined;
      const message = (item.message ?? {}) as Record<string, unknown>;

      output.push({
        fromMe,
        phone,
        remoteJid: jid,
        pushName,
        text: this.messageText(message),
        externalId,
        messageAt: this.messageTimestamp(item, key),
        isGroup,
      });
    }

    return output;
  }

  private phoneFromJid(jid: string): string | null {
    const digits = jid.split('@')[0]?.replace(/\D/g, '') ?? '';
    if (!digits) return null;
    if (digits.length >= 12 && digits.startsWith('55')) {
      const local = digits.slice(-11);
      return isValidMobilePhone(local) ? local : digits;
    }
    const local = normalizeMobilePhone(digits);
    return local || digits;
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
