import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { normalizeEvolutionBaseUrl, SystemSettingsService } from '../system-settings/system-settings.service';
import { EvolutionInstance } from './evolution-instance.entity';
import {
  formatPhoneLenient,
  evolutionGroupSubjectTitle,
  extractGroupSubjectFromRecord,
  groupLabelFromKey,
  isGenericGroupThreadName,
  isGroupContactKey,
  pickBestGroupThreadName,
  isHumanContactName,
  isWhatsAppLidJid,
  isWhatsAppPhoneJid,
  phoneKeyFromJid,
  pickBestThreadContactName,
  resolveEvolutionContact,
} from './evolution-contact.resolver';
import { isValidMobilePhone, normalizeMobilePhone } from '../users/person.utils';

export type EvolutionContactProfileInput = {
  contactKey: string;
  displayName: string;
  phoneLabel: string | null;
  avatarUrl: string | null;
  remoteJid: string | null;
};

export type LidPhoneAlias = {
  phoneContactKey: string;
  phoneLabel: string;
  displayName: string;
  lidJid: string | null;
};

@Injectable()
export class EvolutionRemoteContactsService {
  constructor(
    @InjectRepository(EvolutionInstance)
    private readonly instances: Repository<EvolutionInstance>,
    private readonly systemSettings: SystemSettingsService,
  ) {}

  profileFromEvolutionRecord(record: unknown): EvolutionContactProfileInput | null {
    return this.mapContactRecord(record);
  }

  async fetchContactProfiles(instanceId: string): Promise<EvolutionContactProfileInput[]> {
    const row = await this.instances
      .createQueryBuilder('inst')
      .addSelect('inst.apiKey')
      .where('inst.id = :id', { id: instanceId })
      .getOne();
    if (!row) return [];

    const remote = await this.resolveRemote(row);
    const endpoints = [
      `/chat/findContacts/${encodeURIComponent(row.instanceKey)}`,
      `/chat/findChats/${encodeURIComponent(row.instanceKey)}`,
    ];
    const bodies: Record<string, unknown>[] = [{ where: {} }, {}];

    const byKey = new Map<string, EvolutionContactProfileInput>();

    for (const entry of await this.fetchAllGroupProfiles(row, remote)) {
      byKey.set(entry.contactKey, entry);
    }

    for (const path of endpoints) {
      for (const body of bodies) {
        try {
          const response = await fetch(`${remote.baseUrl}${path}`, {
            method: 'POST',
            headers: remote.headers,
            body: JSON.stringify(body),
          });
          if (!response.ok) continue;
          const payload = (await response.json()) as unknown;
          for (const item of this.collectContactRecords(payload)) {
            const mapped = this.mapContactRecord(item);
            if (!mapped) continue;
            const prev = byKey.get(mapped.contactKey);
            if (!prev) {
              byKey.set(mapped.contactKey, mapped);
              continue;
            }
            const prevGeneric = isGenericGroupThreadName(prev.displayName, mapped.contactKey);
            const nextGeneric = isGenericGroupThreadName(mapped.displayName, mapped.contactKey);
            const displayName =
              prevGeneric && !nextGeneric
                ? mapped.displayName
                : !prevGeneric && nextGeneric
                  ? prev.displayName
                  : mapped.displayName.length > prev.displayName.length
                    ? mapped.displayName
                    : prev.displayName;
            byKey.set(mapped.contactKey, {
              contactKey: mapped.contactKey,
              displayName,
              phoneLabel: mapped.phoneLabel ?? prev.phoneLabel,
              avatarUrl: mapped.avatarUrl ?? prev.avatarUrl,
              remoteJid: mapped.remoteJid ?? prev.remoteJid,
            });
          }
        } catch {
          /* próxima */
        }
      }
    }

    return [...byKey.values()];
  }

  /** Mapeia chave `lid:…` ou JID `@lid` para telefone real vindo de findChats/findContacts. */
  async fetchLidPhoneAliases(instanceId: string): Promise<Map<string, LidPhoneAlias>> {
    const row = await this.instances
      .createQueryBuilder('inst')
      .addSelect('inst.apiKey')
      .where('inst.id = :id', { id: instanceId })
      .getOne();
    if (!row) return new Map();

    const remote = await this.resolveRemote(row);
    const endpoints = [
      `/chat/findContacts/${encodeURIComponent(row.instanceKey)}`,
      `/chat/findChats/${encodeURIComponent(row.instanceKey)}`,
    ];
    const aliases = new Map<string, LidPhoneAlias>();

    const putAlias = (lidKey: string, lidJid: string | null, alias: LidPhoneAlias) => {
      if (!aliases.has(lidKey) || alias.displayName.length > (aliases.get(lidKey)?.displayName.length ?? 0)) {
        aliases.set(lidKey, alias);
      }
      if (lidJid) aliases.set(lidJid.toLowerCase(), alias);
    };

    for (const path of endpoints) {
      try {
        const response = await fetch(`${remote.baseUrl}${path}`, {
          method: 'POST',
          headers: remote.headers,
          body: JSON.stringify({ where: {} }),
        });
        if (!response.ok) continue;
        const payload = (await response.json()) as unknown;
        for (const item of this.collectContactRecords(payload)) {
          const mapped = this.mapLidPhoneAlias(item);
          if (!mapped) continue;
          putAlias(mapped.lidContactKey, mapped.lidJid, mapped.alias);
        }
      } catch {
        /* próximo */
      }
    }

    return aliases;
  }

  private mapLidPhoneAlias(
    row: unknown,
  ): { lidContactKey: string; lidJid: string | null; alias: LidPhoneAlias } | null {
    if (!row || typeof row !== 'object') return null;
    const item = row as Record<string, unknown>;
    const remote = String(item.remoteJid ?? '').trim();
    const alt = String(item.remoteJidAlt ?? '').trim();

    let lidJid: string | null = null;
    let phoneJid: string | null = null;
    if (isWhatsAppLidJid(remote) && isWhatsAppPhoneJid(alt)) {
      lidJid = remote;
      phoneJid = alt;
    } else if (isWhatsAppLidJid(alt) && isWhatsAppPhoneJid(remote)) {
      lidJid = alt;
      phoneJid = remote;
    } else {
      const jidCandidates = [remote, alt, String(item.jid ?? '').trim()].filter((jid) =>
        jid.includes('@'),
      );
      lidJid = jidCandidates.find((jid) => isWhatsAppLidJid(jid)) ?? null;
      phoneJid = jidCandidates.find((jid) => isWhatsAppPhoneJid(jid)) ?? null;
    }
    const phoneKey = phoneJid ? phoneKeyFromJid(phoneJid) : null;
    if (!phoneKey) return null;

    if (!lidJid) return null;
    const lidDigits = lidJid.split('@')[0]?.replace(/\D/g, '') ?? '';
    if (!lidDigits) return null;
    const lidKey = `lid:${lidDigits}`;

    const nameCandidates = [
      item.pushName,
      item.name,
      item.verifiedName,
      item.profileName,
      (item.contact as Record<string, unknown> | undefined)?.name,
    ];
    const pushName = nameCandidates.map((raw) => String(raw ?? '').trim()).find(isHumanContactName);
    const phoneLabel = formatPhoneLenient(phoneKey);
    if (!phoneLabel) return null;

    return {
      lidContactKey: lidKey,
      lidJid,
      alias: {
        phoneContactKey: phoneKey,
        phoneLabel,
        displayName: pickBestThreadContactName([pushName], null, phoneKey, phoneLabel),
        lidJid,
      },
    };
  }

  async enrichAvatars(
    instanceId: string,
    profiles: EvolutionContactProfileInput[],
    max = 200,
  ): Promise<EvolutionContactProfileInput[]> {
    const row = await this.instances
      .createQueryBuilder('inst')
      .addSelect('inst.apiKey')
      .where('inst.id = :id', { id: instanceId })
      .getOne();
    if (!row) return profiles;

    const remote = await this.resolveRemote(row);
    const targets = profiles.filter((profile) => !profile.avatarUrl).slice(0, max);
    const paths = [
      `/chat/fetchProfilePictureUrl/${encodeURIComponent(row.instanceKey)}`,
      `/chat/fetchProfile/${encodeURIComponent(row.instanceKey)}`,
    ];

    for (const profile of targets) {
      const bodies = this.buildAvatarRequestBodies(profile);
      let resolved = false;
      for (const path of paths) {
        for (const body of bodies) {
          try {
            const response = await fetch(`${remote.baseUrl}${path}`, {
              method: 'POST',
              headers: remote.headers,
              body: JSON.stringify(body),
            });
            const text = await response.text();
            if (!response.ok) continue;
            let payload: unknown = {};
            try {
              payload = JSON.parse(text) as Record<string, unknown>;
            } catch {
              continue;
            }
            const avatar = this.parseAvatarFromResponse(payload);
            if (avatar) {
              profile.avatarUrl = avatar;
              resolved = true;
              break;
            }
          } catch {
            /* próximo */
          }
        }
        if (resolved) break;
      }
    }

    return profiles;
  }

  async fetchAvatarForContact(
    instanceId: string,
    profile: Pick<EvolutionContactProfileInput, 'contactKey' | 'remoteJid' | 'phoneLabel'>,
  ): Promise<string | null> {
    const enriched = await this.enrichAvatars(
      instanceId,
      [
        {
          contactKey: profile.contactKey,
          displayName: '',
          phoneLabel: profile.phoneLabel,
          avatarUrl: null,
          remoteJid: profile.remoteJid,
        },
      ],
      1,
    );
    return enriched[0]?.avatarUrl ?? null;
  }

  private buildAvatarRequestBodies(profile: EvolutionContactProfileInput): Record<string, unknown>[] {
    const bodies: Record<string, unknown>[] = [];
    const push = (body: Record<string, unknown>) => {
      const key = JSON.stringify(body);
      if (!bodies.some((item) => JSON.stringify(item) === key)) bodies.push(body);
    };

    if (profile.remoteJid?.includes('@')) {
      push({ number: profile.remoteJid });
      push({ jid: profile.remoteJid });
    }

    const digits = profile.contactKey.replace(/\D/g, '');
    if (profile.contactKey.startsWith('group:') && digits) {
      push({ number: `${digits}@g.us` });
      push({ jid: `${digits}@g.us` });
    }
    if (profile.contactKey.startsWith('lid:') && digits) {
      push({ number: `${digits}@lid` });
      push({ jid: `${digits}@lid` });
    }

    const phone = this.numberForProfileFetch(profile);
    if (phone) {
      push({ number: phone });
      push({ number: `${phone}@s.whatsapp.net` });
      push({ number: `${phone}@c.us` });
    }

    return bodies;
  }

  private parseAvatarFromResponse(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const record = payload as Record<string, unknown>;
    const nested = record.profilePictureUrl ?? record.picture ?? record.imgUrl ?? record.url;

    if (typeof nested === 'string') {
      const value = nested.trim();
      if (!value) return null;
      if (value.startsWith('http') || value.startsWith('data:')) return value;
    }

    if (nested && typeof nested === 'object') {
      const url = String((nested as Record<string, unknown>).url ?? '').trim();
      if (url) return url;
    }

    const base64 = String(record.base64 ?? record.profilePicture ?? record.picture ?? '').trim();
    if (!base64) return null;

    const raw = base64.includes(',') ? base64.split(',')[1]! : base64;
    const mime = String(record.mimetype ?? record.mimeType ?? 'image/jpeg').trim() || 'image/jpeg';
    return `data:${mime};base64,${raw}`;
  }

  private numberForProfileFetch(profile: EvolutionContactProfileInput): string | null {
    if (profile.remoteJid?.includes('@') && !isWhatsAppLidJid(profile.remoteJid)) {
      const digits = profile.remoteJid.split('@')[0]?.replace(/\D/g, '') ?? '';
      if (digits.length >= 12 && digits.startsWith('55')) return digits;
      if (digits.length >= 10) return `55${digits}`;
    }
    const key = profile.contactKey;
    if (key.startsWith('lid:')) return null;
    const digits = key.replace(/\D/g, '');
    if (!digits) return null;
    if (digits.length === 11) return `55${digits}`;
    if (digits.length === 10) return `55${digits}`;
    if (digits.length >= 12) return digits;
    return null;
  }

  private collectGroupRecords(payload: unknown): Record<string, unknown>[] {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload as Record<string, unknown>[];
    if (typeof payload !== 'object') return [];
    const record = payload as Record<string, unknown>;
    const lists = [record.groups, record.data, record.records, record.chats];
    for (const list of lists) {
      if (Array.isArray(list)) return list as Record<string, unknown>[];
    }
    return [];
  }

  private async fetchAllGroupProfiles(
    row: EvolutionInstance,
    remote: { baseUrl: string; headers: Record<string, string> },
  ): Promise<EvolutionContactProfileInput[]> {
    const encoded = encodeURIComponent(row.instanceKey);
    const attempts: Array<{ url: string; method: 'GET' | 'POST'; body?: string }> = [
      {
        url: `${remote.baseUrl}/group/fetchAllGroups/${encoded}?getParticipants=false`,
        method: 'GET',
      },
      {
        url: `${remote.baseUrl}/group/fetchAllGroups/${encoded}?getParticipants=true`,
        method: 'GET',
      },
      {
        url: `${remote.baseUrl}/group/fetchAllGroups/${encoded}`,
        method: 'POST',
        body: JSON.stringify({ getParticipants: false }),
      },
    ];

    const out: EvolutionContactProfileInput[] = [];

    for (const attempt of attempts) {
      try {
        const response = await fetch(attempt.url, {
          method: attempt.method,
          headers: remote.headers,
          body: attempt.method === 'POST' ? attempt.body : undefined,
        });
        if (!response.ok) continue;
        const payload = (await response.json()) as unknown;
        for (const item of this.collectGroupRecords(payload)) {
          const jid = String(item.id ?? item.jid ?? item.remoteJid ?? '').trim();
          if (!jid.includes('@g.us')) continue;
          const digits = jid.split('@')[0]?.replace(/\D/g, '') ?? '';
          if (!digits) continue;
          const contactKey = `group:${digits}`;
          const subject = evolutionGroupSubjectTitle(String(item.subject ?? item.name ?? '').trim(), {
            trustRemote: true,
          });
          const displayName = subject ?? groupLabelFromKey(contactKey);
          const pictureUrl = String(item.pictureUrl ?? item.profilePicUrl ?? item.imgUrl ?? '').trim();
          out.push({
            contactKey,
            displayName,
            phoneLabel: null,
            avatarUrl: pictureUrl.startsWith('http') ? pictureUrl : null,
            remoteJid: jid,
          });
        }
        if (out.length) break;
      } catch {
        /* tenta próximo formato */
      }
    }

    return out;
  }

  private async resolveRemote(row: EvolutionInstance) {
    const platform = await this.systemSettings.readEvolutionPlatformConfig();
    const baseUrl = normalizeEvolutionBaseUrl(platform.baseUrl || row.baseUrl || '');
    const apiKey = String(platform.apiKey || row.apiKey || '').trim();
    return {
      baseUrl,
      apiKey,
      headers: { apikey: apiKey, 'Content-Type': 'application/json' },
    };
  }

  private collectContactRecords(payload: unknown): unknown[] {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (typeof payload !== 'object') return [];
    const record = payload as Record<string, unknown>;
    const lists = [record.contacts, record.chats, record.records, record.data];
    for (const list of lists) {
      if (Array.isArray(list)) return list;
    }
    if (record.id || record.remoteJid || record.jid) return [payload];
    return [];
  }

  private mapContactRecord(row: unknown): EvolutionContactProfileInput | null {
    if (!row || typeof row !== 'object') return null;
    const item = row as Record<string, unknown>;
    const nameCandidates = [
      item.pushName,
      item.name,
      item.verifiedName,
      item.profileName,
      (item.contact as Record<string, unknown> | undefined)?.name,
    ];
    const pushName = nameCandidates.map((raw) => String(raw ?? '').trim()).find(isHumanContactName);

    const jidCandidates = [item.remoteJid, item.remoteJidAlt, item.jid]
      .map((raw) => String(raw ?? '').trim())
      .filter((value) => value.includes('@'));

    const jid =
      jidCandidates[0] ??
      String(item.remoteJid ?? item.remoteJidAlt ?? item.jid ?? '').trim();

    const resolved = resolveEvolutionContact({
      remoteJid: jid,
      remoteJidAlt: String(item.remoteJidAlt ?? item.id ?? ''),
      participant: String(item.participant ?? ''),
    });

    let contactKey: string | null = resolved?.contactKey ?? null;
    const phoneKeyFromAlt = jidCandidates
      .map((candidate) => phoneKeyFromJid(candidate))
      .find((value) => value && !value.startsWith('lid:'));
    if (jid.includes('@g.us')) {
      const digits = jid.split('@')[0]?.replace(/\D/g, '') ?? '';
      if (digits) {
        contactKey = `group:${digits}`;
      }
    }

    if (!contactKey || contactKey === 'unknown') {
      if (isWhatsAppPhoneJid(jid)) {
        const fromJid = phoneKeyFromJid(jid);
        if (!fromJid) return null;
        contactKey = fromJid;
      } else if (isWhatsAppLidJid(jid)) {
        const digits = jid.split('@')[0]?.replace(/\D/g, '') ?? '';
        if (!digits) return null;
        contactKey = `lid:${digits}`;
      } else {
        return null;
      }
    }

    const groupSubject = contactKey.startsWith('group:')
      ? extractGroupSubjectFromRecord(item)
      : undefined;

    const phoneLabel =
      formatPhoneLenient(contactKey) ??
      (phoneKeyFromAlt ? formatPhoneLenient(phoneKeyFromAlt) : null);
    const displayName = isGroupContactKey(contactKey)
      ? pickBestGroupThreadName(
          [
            groupSubject,
            String(item.subject ?? '').trim() || null,
            String(item.name ?? '').trim() || null,
            String(item.groupName ?? '').trim() || null,
            String(item.conversationName ?? '').trim() || null,
          ],
          contactKey,
        )
      : pickBestThreadContactName([pushName], null, contactKey, phoneLabel);
    const avatarUrl =
      this.parseAvatarFromResponse({
        profilePictureUrl: item.profilePicUrl ?? item.profilePictureUrl ?? item.picture,
        base64: item.profilePicture,
        mimetype: item.mimetype,
      }) ??
      (String(item.imgUrl ?? '').trim() || null);

    return {
      contactKey,
      displayName,
      phoneLabel,
      avatarUrl,
      remoteJid: jid || null,
    };
  }
}
