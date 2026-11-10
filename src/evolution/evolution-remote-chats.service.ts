import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { normalizeEvolutionBaseUrl, SystemSettingsService } from '../system-settings/system-settings.service';
import { EvolutionInstance } from './evolution-instance.entity';
import { resolveEvolutionContact } from './evolution-contact.resolver';
import {
  collectEvolutionChatRows,
  readChatArchived,
  readChatUnreadCount,
} from './evolution-chat.parser';

export type EvolutionRemoteChatRow = {
  contactKey: string;
  remoteJid: string;
  archived: boolean | null;
  unreadCount: number | null;
  raw: Record<string, unknown>;
};

@Injectable()
export class EvolutionRemoteChatsService {
  constructor(
    @InjectRepository(EvolutionInstance)
    private readonly instances: Repository<EvolutionInstance>,
    private readonly systemSettings: SystemSettingsService,
  ) {}

  async fetchChats(instanceId: string): Promise<EvolutionRemoteChatRow[]> {
    const row = await this.instances
      .createQueryBuilder('inst')
      .addSelect('inst.apiKey')
      .addSelect('inst.baseUrl')
      .where('inst.id = :id', { id: instanceId })
      .getOne();
    if (!row) return [];

    const remote = await this.resolveRemote(row);
    const encoded = encodeURIComponent(row.instanceKey);
    const attempts = [
      { method: 'POST' as const, url: `${remote.baseUrl}/chat/findChats/${encoded}`, body: {} },
      { method: 'GET' as const, url: `${remote.baseUrl}/chat/findChats/${encoded}`, body: undefined },
    ];

    for (const attempt of attempts) {
      try {
        const response = await fetch(attempt.url, {
          method: attempt.method,
          headers: remote.headers,
          body: attempt.body !== undefined ? JSON.stringify(attempt.body) : undefined,
        });
        if (!response.ok) continue;
        const payload = (await response.json()) as unknown;
        return this.mapChatPayload(payload);
      } catch {
        /* próxima */
      }
    }
    return [];
  }

  async archiveChat(
    instanceId: string,
    input: {
      remoteJid: string;
      archive: boolean;
      lastMessage?: Record<string, unknown> | null;
    },
  ): Promise<{ ok: boolean; error?: string }> {
    const row = await this.instances
      .createQueryBuilder('inst')
      .addSelect('inst.apiKey')
      .addSelect('inst.baseUrl')
      .where('inst.id = :id', { id: instanceId })
      .getOne();
    if (!row) return { ok: false, error: 'Instância não encontrada.' };

    const remote = await this.resolveRemote(row);
    const encoded = encodeURIComponent(row.instanceKey);
    const chat = String(input.remoteJid ?? '').trim();
    if (!chat) return { ok: false, error: 'Chat inválido.' };

    const lastMessage =
      input.lastMessage && Object.keys(input.lastMessage).length
        ? {
            ...input.lastMessage,
            messageTimestamp:
              (input.lastMessage as { messageTimestamp?: number }).messageTimestamp ??
              Math.floor(Date.now() / 1000),
          }
        : null;

    const bodyVariants: Record<string, unknown>[] = [
      { chat, archive: Boolean(input.archive), ...(lastMessage ? { lastMessage } : {}) },
      { number: chat, archive: Boolean(input.archive), ...(lastMessage ? { lastMessage } : {}) },
    ];

    const path = `/chat/archiveChat/${encoded}`;
    let lastError = '';

    for (const body of bodyVariants) {
      try {
        const response = await fetch(`${remote.baseUrl}${path}`, {
          method: 'POST',
          headers: remote.headers,
          body: JSON.stringify(body),
        });
        if (response.ok) return { ok: true };
        const text = await response.text();
        lastError = text.slice(0, 400);
        if (response.status === 404) {
          lastError = `Rota não disponível na Evolution (${path}).`;
          break;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    return { ok: false, error: lastError || 'Falha ao arquivar conversa na Evolution.' };
  }

  private mapChatPayload(payload: unknown): EvolutionRemoteChatRow[] {
    const rows: EvolutionRemoteChatRow[] = [];
    for (const chat of collectEvolutionChatRows(payload)) {
      const jid = String(chat.id ?? chat.remoteJid ?? chat.jid ?? '').trim();
      if (!jid) continue;
      const resolved = resolveEvolutionContact({
        remoteJid: jid,
        remoteJidAlt: String(chat.remoteJidAlt ?? chat.remoteJid ?? ''),
      });
      if (!resolved || resolved.contactKey === 'unknown') continue;
      rows.push({
        contactKey: resolved.contactKey,
        remoteJid: resolved.remoteJid,
        archived: readChatArchived(chat),
        unreadCount: readChatUnreadCount(chat),
        raw: chat,
      });
    }
    return rows;
  }

  private async resolveRemote(row: EvolutionInstance) {
    const platform = await this.systemSettings.readEvolutionPlatformConfig();
    const baseUrl = normalizeEvolutionBaseUrl(platform.baseUrl || row.baseUrl || '');
    const apiKey = String(platform.apiKey || row.apiKey || '').trim();
    return {
      baseUrl,
      headers: { apikey: apiKey, 'Content-Type': 'application/json' },
    };
  }
}
