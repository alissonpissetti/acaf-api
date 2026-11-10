import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { normalizeEvolutionBaseUrl, SystemSettingsService } from '../system-settings/system-settings.service';
import { EvolutionInstance } from './evolution-instance.entity';
import { collectEvolutionMessageRows, readEvolutionRowMessageAt } from './evolution-message.parser';

@Injectable()
export class EvolutionRemoteMessagesService {
  constructor(
    @InjectRepository(EvolutionInstance)
    private readonly instances: Repository<EvolutionInstance>,
    private readonly systemSettings: SystemSettingsService,
  ) {}

  async fetchMessagesForJid(
    instanceId: string,
    remoteJid: string,
    limit = 60,
    options?: { since?: Date },
  ): Promise<unknown> {
    const jid = String(remoteJid ?? '').trim();
    if (!jid) return { messages: [] };

    const row = await this.instances
      .createQueryBuilder('inst')
      .addSelect('inst.apiKey')
      .addSelect('inst.baseUrl')
      .where('inst.id = :id', { id: instanceId })
      .getOne();
    if (!row) return { messages: [] };

    const remote = await this.resolveRemote(row);
    const encoded = encodeURIComponent(row.instanceKey);
    const endpoint = `${remote.baseUrl}/chat/findMessages/${encoded}`;
    const safeLimit = Math.min(Math.max(limit, 10), 120);
    const sinceMs =
      options?.since && !Number.isNaN(options.since.getTime())
        ? Math.max(0, options.since.getTime() - 120_000)
        : null;
    const sinceSec = sinceMs != null ? Math.floor(sinceMs / 1000) : null;

    const whereBase: Record<string, unknown> = { key: { remoteJid: jid } };
    if (sinceSec != null) {
      whereBase.messageTimestamp = { gt: sinceSec };
    }

    const bodies: Record<string, unknown>[] = [
      { where: whereBase, limit: safeLimit, sort: { messageTimestamp: -1 } },
      {
        where: sinceSec != null ? { remoteJid: jid, messageTimestamp: { gt: sinceSec } } : { remoteJid: jid },
        limit: safeLimit,
        sort: { messageTimestamp: -1 },
      },
      { where: sinceSec != null ? { remoteJid: jid, messageTimestamp: { gt: sinceSec } } : { remoteJid: jid }, limit: safeLimit },
      { where: whereBase, limit: safeLimit },
    ];

    const merged: unknown[] = [];
    const seen = new Set<string>();

    for (const body of bodies) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: remote.headers,
          body: JSON.stringify(body),
        });
        if (!response.ok) continue;
        const payload = (await response.json()) as unknown;
        const record =
          payload && typeof payload === 'object'
            ? ((payload as Record<string, unknown>).messages ?? payload)
            : payload;
        for (const row of collectEvolutionMessageRows(record)) {
          if (!row || typeof row !== 'object') continue;
          const item = row as Record<string, unknown>;
          const key = (item.key ?? {}) as Record<string, unknown>;
          const rowJid = String(key.remoteJid ?? item.remoteJid ?? '').trim();
          if (rowJid && rowJid.toLowerCase() !== jid.toLowerCase()) continue;
          const id = String(key.id ?? item.id ?? '').trim();
          const sig = id || JSON.stringify(item).slice(0, 160);
          if (seen.has(sig)) continue;
          if (sinceMs != null) {
            const at = readEvolutionRowMessageAt(item);
            if (at && at.getTime() < sinceMs) continue;
          }
          seen.add(sig);
          merged.push(item);
        }
        if (merged.length) return { messages: merged };
      } catch {
        /* próximo formato */
      }
    }

    return { messages: merged };
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
