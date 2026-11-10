import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CommercialLeadsService } from '../commercial/commercial-leads.service';
import { CommercialLead } from '../commercial/commercial-lead.entity';
import { EvolutionInstance } from './evolution-instance.entity';
import { EvolutionMessage } from './evolution-message.entity';
import { EvolutionInboxRead } from './evolution-inbox-read.entity';
import {
  contactLabelFromKey,
  formatPhoneLenient,
  groupLabelFromKey,
  isGroupContactKey,
  evolutionGroupSubjectTitle,
  isGenericGroupThreadName,
  isLikelyParticipantName,
  isPlausibleGroupTitle,
  pickBestGroupThreadName,
  isHumanContactName,
  pickBestThreadContactName,
  resolveInboxContactPresentation,
} from './evolution-contact.resolver';
import { parseEvolutionMessagePayload } from './evolution-message.parser';
import { bodyTextFromWhatsAppMessage, resolveMessageEnvelope } from './evolution-message-media';
import { EvolutionRemoteMediaService } from './evolution-remote-media.service';
import { EvolutionRemoteContactsService } from './evolution-remote-contacts.service';
import { EvolutionContactProfile } from './evolution-contact-profile.entity';
import { EvolutionContactAvatarService } from './evolution-contact-avatar.service';
import { EvolutionInboxRealtimeService } from './evolution-inbox-realtime.service';
import { EvolutionMessageMediaStorageService } from './evolution-message-media-storage.service';
import type { LidPhoneAlias } from './evolution-remote-contacts.service';
import { normalizeMobilePhone, isValidMobilePhone } from '../users/person.utils';

export type ParsedEvolutionMessage = {
  fromMe: boolean;
  phone: string | null;
  contactKey: string;
  remoteJid: string;
  pushName?: string;
  groupName?: string | null;
  text: string;
  externalId: string;
  messageAt: Date;
  isGroup: boolean;
  mediaKind: string | null;
  mediaPayload: string | null;
  mediaMimeType: string | null;
  senderName?: string | null;
  senderJid?: string | null;
};

export type EvolutionInboxThreadDto = {
  threadKey: string;
  instanceId: string;
  instanceName: string;
  contactPhone: string;
  contactName: string | null;
  contactDisplayName: string;
  contactSubtitle: string | null;
  contactPhoneLabel: string | null;
  contactKind: 'named' | 'phone' | 'private' | 'unknown';
  contactNameLine: string | null;
  contactPhoneLine: string | null;
  contactBadge: string | null;
  isPrivateContact: boolean;
  isGroupThread: boolean;
  avatarUrl: string | null;
  leadId: string | null;
  leadTitle: string | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  lastDirection: 'in' | 'out';
  unreadCount: number;
};

export type EvolutionInboxMessageDto = {
  id: string;
  direction: 'in' | 'out';
  body: string;
  contactName: string | null;
  senderName: string | null;
  messageAt: string;
  leadId: string | null;
  mediaKind: string | null;
  hasMedia: boolean;
};

@Injectable()
export class EvolutionInboxService {
  private readonly groupTitleRefreshAt = new Map<string, number>();

  constructor(
    @InjectRepository(EvolutionMessage)
    private readonly messages: Repository<EvolutionMessage>,
    @InjectRepository(EvolutionInboxRead)
    private readonly inboxReads: Repository<EvolutionInboxRead>,
    @InjectRepository(EvolutionInstance)
    private readonly instances: Repository<EvolutionInstance>,
    @InjectRepository(EvolutionContactProfile)
    private readonly contactProfiles: Repository<EvolutionContactProfile>,
    @InjectRepository(CommercialLead)
    private readonly leads: Repository<CommercialLead>,
    private readonly commercialLeads: CommercialLeadsService,
    private readonly remoteMedia: EvolutionRemoteMediaService,
    private readonly remoteContacts: EvolutionRemoteContactsService,
    private readonly contactAvatars: EvolutionContactAvatarService,
    private readonly inboxRealtime: EvolutionInboxRealtimeService,
    private readonly messageMediaStorage: EvolutionMessageMediaStorageService,
  ) {}

  private queueMessageMediaPersist(messageId: string, options?: { force?: boolean }) {
    void this.messageMediaStorage.persistMessageMedia(messageId, options).catch(() => {});
  }

  async ingestFromInstance(
    instance: EvolutionInstance,
    input: {
      ownerUserId: string;
      parsed: ParsedEvolutionMessage;
    },
  ): Promise<{
    leadId: string | null;
    created: boolean;
    messageId: string | null;
    ingested: boolean;
  }> {
    const { parsed, ownerUserId } = input;
    const ingestContactKey = String(parsed.contactKey ?? '').trim();
    if (!ingestContactKey || ingestContactKey === 'unknown') {
      return { leadId: null, created: false, messageId: null, ingested: false };
    }
    parsed.contactKey = ingestContactKey;

    const duplicate = await this.messages.findOne({
      where: { instanceId: instance.id, externalId: parsed.externalId },
      select: ['id', 'leadId'],
    });

    let leadId: string | null = null;
    let created = false;
    if (!parsed.isGroup) {
      const leadOutcome = await this.commercialLeads.ensureLeadFromWhatsAppInbox({
        contactKey: parsed.contactKey,
        phone: parsed.phone,
        pushName: parsed.pushName,
        messageText: parsed.text,
        externalId: parsed.externalId,
        ownerUserId,
        createdByUserId: ownerUserId,
        instanceLabel: instance.name,
        recordInteraction: !parsed.fromMe,
      });
      leadId = leadOutcome.leadId;
      created = leadOutcome.created;
    }

    const contactName = parsed.isGroup
      ? pickBestGroupThreadName(
          [parsed.groupName, parsed.pushName, groupLabelFromKey(parsed.contactKey)],
          parsed.contactKey,
        )
      : await this.resolveStoredContactName(parsed, leadId);

    if (duplicate) {
      if (leadId) {
        await this.messages.update(
          { instanceId: instance.id, contactPhone: parsed.contactKey },
          { leadId },
        );
      }
      if (!parsed.isGroup && contactName) {
        await this.messages.update(
          { instanceId: instance.id, contactPhone: parsed.contactKey },
          { contactName },
        );
      }
      const messagePatch: Partial<EvolutionMessage> = {};
      if (parsed.isGroup) {
        messagePatch.senderName = parsed.senderName ?? null;
        messagePatch.senderJid = parsed.senderJid ?? null;
        if (!parsed.fromMe) messagePatch.contactName = parsed.senderName ?? null;
      }
      if (parsed.mediaKind && parsed.mediaPayload) {
        messagePatch.mediaKind = parsed.mediaKind;
        messagePatch.mediaPayload = parsed.mediaPayload;
        messagePatch.mediaMimeType = parsed.mediaMimeType;
        messagePatch.mediaStoragePath = null;
        messagePatch.mediaContentHash = null;
        messagePatch.mediaStoredAt = null;
        if (parsed.text?.trim()) messagePatch.body = parsed.text.slice(0, 2000);
      }
      if (Object.keys(messagePatch).length) {
        await this.messages.update({ id: duplicate.id }, messagePatch);
        if (parsed.mediaKind && parsed.mediaPayload) {
          this.queueMessageMediaPersist(duplicate.id, { force: true });
        }
      }
      await this.upsertContactProfile({
        instanceId: instance.id,
        contactKey: parsed.contactKey,
        displayName: contactName,
        phoneLabel: formatPhoneLenient(parsed.contactKey),
        remoteJid: parsed.remoteJid,
        leadId,
      });
      this.publishInboxActivity(instance.id, parsed.contactKey, duplicate.id, false);
      return { leadId, created: false, messageId: duplicate.id, ingested: false };
    }

    if (!parsed.isGroup && contactName && isHumanContactName(contactName)) {
      await this.messages.update(
        { instanceId: instance.id, contactPhone: parsed.contactKey },
        { contactName },
      );
    }

    const messageRowContactName = parsed.isGroup
      ? parsed.fromMe
        ? null
        : parsed.senderName ?? null
      : contactName;

    const saved = await this.messages.save(
      this.messages.create({
        instanceId: instance.id,
        contactPhone: parsed.contactKey,
        contactName: messageRowContactName,
        senderName: parsed.isGroup ? parsed.senderName ?? null : null,
        senderJid: parsed.isGroup ? parsed.senderJid ?? null : null,
        remoteJid: parsed.remoteJid,
        direction: parsed.fromMe ? 'out' : 'in',
        body: parsed.text.slice(0, 2000),
        externalId: parsed.externalId,
        leadId,
        messageAt: parsed.messageAt,
        mediaKind: parsed.mediaKind,
        mediaPayload: parsed.mediaPayload,
        mediaMimeType: parsed.mediaMimeType,
      }),
    );

    await this.upsertContactProfile({
      instanceId: instance.id,
      contactKey: parsed.contactKey,
      displayName: contactName,
      phoneLabel: formatPhoneLenient(parsed.contactKey),
      remoteJid: parsed.remoteJid,
      leadId,
    });

    if (parsed.mediaKind && parsed.mediaPayload) {
      this.queueMessageMediaPersist(saved.id);
    }

    this.publishInboxActivity(instance.id, parsed.contactKey, saved.id, true);
    return { leadId, created, messageId: saved.id, ingested: true };
  }

  private publishInboxActivity(
    instanceId: string,
    contactKey: string,
    messageId: string | null,
    ingested: boolean,
  ) {
    this.inboxRealtime.notifyThreadActivity({
      instanceId,
      contactPhone: contactKey,
      messageId,
      ingested,
    });
  }

  private inferGroupSenderNameFromBody(body: string | null | undefined): string | null {
    const text = String(body ?? '').trim();
    const match = /^([^:\n]{2,48}):\s+/u.exec(text);
    if (!match?.[1]) return null;
    const name = match[1].trim();
    if (!isHumanContactName(name) || isPlausibleGroupTitle(name)) return null;
    return name;
  }

  private isInboxBodyPlaceholder(body: string): boolean {
    const text = String(body ?? '').trim();
    if (!text) return true;
    return /^\(mensagem\)$/i.test(text) || /^\[[\wáéíóúãõç\s]+\]$/i.test(text);
  }

  private mediaFallbackLabel(mediaKind: string | null | undefined): string {
    const fallback: Record<string, string> = {
      image: '[imagem]',
      video: '[vídeo]',
      audio: '[áudio]',
      document: '[documento]',
      sticker: '[figurinha]',
    };
    return fallback[String(mediaKind ?? '').trim()] ?? '(mensagem)';
  }

  private extractBodyTextFromStoredMessage(row: EvolutionMessage): string | null {
    if (!row.mediaPayload?.trim()) return null;
    try {
      const payload = JSON.parse(row.mediaPayload) as Record<string, unknown>;
      const key = (payload.key ?? {}) as Record<string, unknown>;
      const { inner } = resolveMessageEnvelope(payload, key);
      const text =
        bodyTextFromWhatsAppMessage(inner) ||
        bodyTextFromWhatsAppMessage((payload.message ?? {}) as Record<string, unknown>);
      if (text?.trim()) return text.trim();
      if (row.mediaKind) return this.mediaFallbackLabel(row.mediaKind);
      return null;
    } catch {
      return null;
    }
  }

  private formatMessageBodyForInbox(row: EvolutionMessage): string {
    let body = String(row.body ?? '').trim();
    if (this.isInboxBodyPlaceholder(body)) {
      const recovered = this.extractBodyTextFromStoredMessage(row);
      if (recovered) body = recovered;
    }
    const sender = row.senderName?.trim() || this.inferGroupSenderNameFromBody(body);
    if (sender && body.startsWith(`${sender}:`)) {
      body = body.slice(sender.length + 1).trimStart();
    }
    return body;
  }

  private threadLastMessagePreview(row: EvolutionMessage): string {
    let body = this.formatMessageBodyForInbox(row);
    if (isGroupContactKey(row.contactPhone) && row.direction === 'in') {
      const sender = row.senderName?.trim() || this.inferGroupSenderNameFromBody(row.body);
      if (sender && !body.toLowerCase().startsWith(`${sender.toLowerCase()}:`)) {
        body = `${sender}: ${body}`;
      }
    }
    return body.slice(0, 500);
  }

  private buildThreadSubtitle(
    instanceName: string,
    phoneLabel: string | null,
    displayName: string,
  ): string {
    const parts: string[] = [];
    if (phoneLabel && phoneLabel !== displayName) parts.push(phoneLabel);
    parts.push(instanceName);
    return parts.filter(Boolean).join(' · ');
  }

  private async upsertContactProfile(input: {
    instanceId: string;
    contactKey: string;
    displayName: string | null;
    phoneLabel: string | null;
    remoteJid: string | null;
    avatarUrl?: string | null;
    leadId?: string | null;
  }): Promise<void> {
    const contactKey = String(input.contactKey ?? '').trim();
    if (!contactKey || contactKey === 'unknown') return;

    const labelFallback = contactLabelFromKey(
      contactKey,
      input.phoneLabel && !input.displayName ? input.phoneLabel : input.displayName,
    );
    const existing = await this.contactProfiles.findOne({
      where: { instanceId: input.instanceId, contactKey },
    });
    if (existing) {
      let nextDisplay = isHumanContactName(input.displayName)
        ? String(input.displayName).trim()
        : isHumanContactName(existing.displayName)
          ? existing.displayName
          : labelFallback;
      if (isGroupContactKey(contactKey)) {
        const fromInput = isPlausibleGroupTitle(input.displayName) ? String(input.displayName).trim() : null;
        const fromExisting = isPlausibleGroupTitle(existing.displayName) ? existing.displayName : null;
        nextDisplay = fromInput ?? fromExisting ?? groupLabelFromKey(contactKey);
      }
      existing.displayName = nextDisplay;
      if (input.phoneLabel) existing.phoneLabel = input.phoneLabel;
      if (input.remoteJid) existing.remoteJid = input.remoteJid;
      if (input.avatarUrl && !(existing.avatarStoragePath && existing.avatarUrl?.startsWith('http'))) {
        existing.avatarUrl = input.avatarUrl;
      }
      if (input.leadId) existing.leadId = input.leadId;
      await this.contactProfiles.save(existing);
      return;
    }
    const createDisplay = isGroupContactKey(contactKey)
      ? pickBestGroupThreadName([input.displayName, labelFallback], contactKey)
      : isHumanContactName(input.displayName)
        ? String(input.displayName).trim()
        : labelFallback;
    await this.contactProfiles.save(
      this.contactProfiles.create({
        instanceId: input.instanceId,
        contactKey,
        displayName: createDisplay,
        phoneLabel: input.phoneLabel,
        remoteJid: input.remoteJid,
        avatarUrl: input.avatarUrl ?? null,
        leadId: input.leadId ?? null,
      }),
    );
  }

  private async resolveStoredContactName(
    parsed: ParsedEvolutionMessage,
    leadId: string | null,
  ): Promise<string | null> {
    if (parsed.pushName?.trim() && !parsed.fromMe) {
      return parsed.pushName.trim();
    }
    if (!leadId) return null;
    const lead = await this.leads.findOne({
      where: { id: leadId },
      select: ['id', 'title', 'contactName'],
    });
    if (!lead) return null;
    return lead.contactName?.trim() || lead.title?.trim() || null;
  }

  private pickCanonicalContactKey(current: string, candidate: string): string {
    const rank = (key: string) => {
      if (key.startsWith('group:')) return 30;
      if (!key.startsWith('lid:') && !key.startsWith('group:')) return 20;
      if (key.startsWith('lid:')) return 10;
      return 0;
    };
    return rank(candidate) > rank(current) ? candidate : current;
  }

  private mergeInboxThreads(threads: EvolutionInboxThreadDto[]): EvolutionInboxThreadDto[] {
    const groups = new Map<string, EvolutionInboxThreadDto[]>();
    for (const thread of threads) {
      const groupKey = thread.leadId
        ? `${thread.instanceId}:lead:${thread.leadId}`
        : thread.threadKey;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey)!.push(thread);
    }

    const merged: EvolutionInboxThreadDto[] = [];
    for (const group of groups.values()) {
      const best = group.reduce((a, b) =>
        new Date(a.lastMessageAt) > new Date(b.lastMessageAt) ? a : b,
      );
      let contactPhone = best.contactPhone;
      for (const row of group) {
        contactPhone = this.pickCanonicalContactKey(contactPhone, row.contactPhone);
      }
      const threadKey = `${best.instanceId}:${contactPhone}`;
      const avatarUrl = group.map((row) => row.avatarUrl).find(Boolean) ?? best.avatarUrl;
      const unreadCount = group.reduce((sum, row) => sum + (row.unreadCount ?? 0), 0);
      merged.push({ ...best, contactPhone, threadKey, avatarUrl, unreadCount });
    }

    return merged.sort(
      (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
    );
  }

  private async resolveThreadContactKeys(instanceId: string, contactKey: string): Promise<string[]> {
    const keys = new Set<string>([contactKey]);

    const siblingRows = await this.messages
      .createQueryBuilder('m')
      .select('DISTINCT m.contact_phone', 'contactPhone')
      .where('m.instance_id = :instanceId', { instanceId })
      .andWhere(
        `m.lead_id IS NOT NULL AND m.lead_id IN (
          SELECT m2.lead_id FROM acaf_evolution_messages m2
          WHERE m2.instance_id = :instanceId AND m2.contact_phone = :contactKey AND m2.lead_id IS NOT NULL
        )`,
      )
      .setParameters({ instanceId, contactKey })
      .getRawMany<{ contactPhone: string }>();

    for (const row of siblingRows) {
      const phone = String(row.contactPhone ?? '').trim();
      if (phone) keys.add(phone);
    }

    const profile = await this.contactProfiles.findOne({
      where: { instanceId, contactKey },
      select: ['leadId'],
    });
    if (profile?.leadId) {
      const profiles = await this.contactProfiles.find({
        where: { instanceId, leadId: profile.leadId },
        select: ['contactKey'],
      });
      for (const row of profiles) keys.add(row.contactKey);
    }

    return [...keys].filter((key) => key.trim() && key !== 'unknown');
  }

  async markThreadRead(userId: string, instanceId: string, contactKey: string): Promise<void> {
    const key = String(contactKey ?? '').trim();
    if (!userId || !instanceId || !key) return;

    const now = new Date();
    const existing = await this.inboxReads.findOne({
      where: { userId, instanceId, contactKey: key },
    });
    if (existing) {
      existing.lastReadAt = now;
      await this.inboxReads.save(existing);
      return;
    }
    await this.inboxReads.save(
      this.inboxReads.create({
        userId,
        instanceId,
        contactKey: key,
        lastReadAt: now,
      }),
    );
  }

  private async countUnreadMessages(
    userId: string,
    instanceId: string,
    contactKey: string,
  ): Promise<number> {
    const keys = await this.resolveThreadContactKeys(instanceId, contactKey);
    const read = await this.inboxReads.findOne({
      where: { userId, instanceId, contactKey },
    });

    const qb = this.messages
      .createQueryBuilder('m')
      .where('m.instance_id = :instanceId', { instanceId })
      .andWhere('m.contact_phone IN (:...keys)', { keys })
      .andWhere("m.direction = 'in'");

    if (read?.lastReadAt) {
      qb.andWhere('m.message_at > :since', { since: read.lastReadAt });
    }

    return qb.getCount();
  }

  async listThreads(
    userId: string,
    filters?: { instanceId?: string },
  ): Promise<EvolutionInboxThreadDto[]> {
    const instanceId = filters?.instanceId?.trim();
    if (instanceId) {
      const last = this.groupTitleRefreshAt.get(instanceId) ?? 0;
      const ttlMs = 5 * 60_000;
      if (Date.now() - last > ttlMs) {
        try {
          await this.backfillGroupThreadNames(instanceId);
          await this.backfillMessageBodiesFromPayload(instanceId, 800);
          this.groupTitleRefreshAt.set(instanceId, Date.now());
        } catch {
          /* mantém cache local */
        }
      }
    }

    const latestSub = this.messages
      .createQueryBuilder('lm')
      .select('lm.instance_id', 'instanceId')
      .addSelect('lm.contact_phone', 'contactPhone')
      .addSelect('MAX(lm.message_at)', 'maxAt')
      .where("lm.contact_phone IS NOT NULL AND TRIM(lm.contact_phone) <> ''")
      .andWhere("lm.contact_phone NOT IN ('unknown', '-')")
      .groupBy('lm.instance_id')
      .addGroupBy('lm.contact_phone');

    if (filters?.instanceId) {
      latestSub.andWhere('lm.instance_id = :instanceId', { instanceId: filters.instanceId });
    }

    const qb = this.messages
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.instance', 'inst')
      .innerJoin(
        `(${latestSub.getQuery()})`,
        'latest',
        'm.instance_id = latest.instanceId AND m.contact_phone = latest.contactPhone AND m.message_at = latest.maxAt',
      )
      .setParameters(latestSub.getParameters());

    if (filters?.instanceId) {
      qb.andWhere('m.instance_id = :instanceId', { instanceId: filters.instanceId });
    }

    const rows = await qb.getMany();
    const draftThreads: EvolutionInboxThreadDto[] = [];

    const leadIds = [...new Set(rows.map((row) => row.leadId).filter(Boolean))] as string[];
    const leadRows = leadIds.length
      ? await this.leads.find({
          where: { id: In(leadIds) },
          select: ['id', 'title', 'contactName', 'phone'],
        })
      : [];
    const leadById = new Map(leadRows.map((lead) => [lead.id, lead]));

    const instanceIds = [...new Set(rows.map((row) => row.instanceId))];
    const profileRows = instanceIds.length
      ? await this.contactProfiles.find({ where: { instanceId: In(instanceIds) } })
      : [];
    const profileByKey = new Map(
      profileRows.map((row) => [`${row.instanceId}:${row.contactKey}`, row]),
    );

    for (const latest of rows) {
      const contactPhone = String(latest.contactPhone ?? '').trim();
      if (!contactPhone || contactPhone === 'unknown') continue;

      const threadKey = `${latest.instanceId}:${contactPhone}`;
      const lead = latest.leadId ? leadById.get(latest.leadId) ?? null : null;
      const leadTitle = lead?.title ?? null;
      const profile = this.findContactProfileForAvatar(
        latest.instanceId,
        contactPhone,
        profileRows,
        latest.leadId,
      );
      const profileGroupTitle =
        profile?.displayName &&
        !isGenericGroupThreadName(profile.displayName, contactPhone) &&
        (evolutionGroupSubjectTitle(profile.displayName) || isPlausibleGroupTitle(profile.displayName))
          ? profile.displayName
          : null;
      const messageNames = isGroupContactKey(contactPhone)
        ? [profileGroupTitle]
        : [latest.direction === 'in' ? latest.contactName : null, profile?.displayName];
      const contactPhoneLabel = profile?.phoneLabel ?? formatPhoneLenient(contactPhone);
      const contactDisplayName = pickBestThreadContactName(
        messageNames,
        lead,
        contactPhone,
        contactPhoneLabel,
      );
      const presentation = resolveInboxContactPresentation({
        contactKey: contactPhone,
        displayName: contactDisplayName,
        phoneLabel: contactPhoneLabel,
        instanceName: latest.instance?.name ?? 'WhatsApp',
        leadTitle,
        leadContactName: lead?.contactName ?? null,
        leadPhone: lead?.phone ?? null,
      });
      const contactSubtitle =
        presentation.subtitle ??
        this.buildThreadSubtitle(
          latest.instance?.name ?? 'WhatsApp',
          contactPhoneLabel,
          contactDisplayName,
        );
      const avatarStored = Boolean(profile?.avatarStoragePath);
      const proxyPath = avatarStored
        ? `/api/admin/evolution/inbox/threads/${latest.instanceId}/${encodeURIComponent(contactPhone)}/avatar`
        : null;
      const avatarUrl = avatarStored
        ? proxyPath
        : profile?.avatarUrl?.startsWith('http')
          ? profile.avatarUrl
          : null;

      draftThreads.push({
        threadKey,
        instanceId: latest.instanceId,
        instanceName: latest.instance?.name ?? 'WhatsApp',
        contactPhone,
        contactName: isHumanContactName(latest.contactName) ? latest.contactName : null,
        contactDisplayName: presentation.title,
        contactSubtitle,
        contactPhoneLabel: presentation.phoneLine ?? contactPhoneLabel,
        contactKind: presentation.kind,
        contactNameLine: presentation.nameLine,
        contactPhoneLine: presentation.phoneLine,
        contactBadge: presentation.badge,
        isPrivateContact: presentation.isPrivateContact,
        isGroupThread: isGroupContactKey(contactPhone),
        avatarUrl,
        leadId: latest.leadId,
        leadTitle: isHumanContactName(leadTitle) ? leadTitle : null,
        lastMessageAt: latest.messageAt.toISOString(),
        lastMessagePreview: this.threadLastMessagePreview(latest),
        lastDirection: latest.direction,
        unreadCount: userId
          ? await this.countUnreadMessages(userId, latest.instanceId, contactPhone)
          : 0,
      });
    }

    return this.mergeInboxThreads(draftThreads);
  }

  async listThreadMessages(
    userId: string | null,
    instanceId: string,
    contactPhone: string,
    limit = 300,
  ): Promise<EvolutionInboxMessageDto[]> {
    const contactKey = String(contactPhone ?? '').trim();
    if (!contactKey) throw new NotFoundException('Conversa não encontrada.');

    const instance = await this.instances.findOne({ where: { id: instanceId }, select: ['id'] });
    if (!instance) throw new NotFoundException('Instância não encontrada.');

    if (userId) {
      await this.markThreadRead(userId, instanceId, contactKey);
    }

    const contactKeys = await this.resolveThreadContactKeys(instanceId, contactKey);
    const rows = await this.messages.find({
      where: { instanceId, contactPhone: In(contactKeys) },
      order: { messageAt: 'DESC' },
      take: limit,
    });

    if (!rows.length) throw new NotFoundException('Nenhuma mensagem nesta conversa.');

    const chronological = [...rows].reverse();

    return chronological.map((row) => ({
      id: row.id,
      direction: row.direction,
      body: this.formatMessageBodyForInbox(row),
      contactName: isHumanContactName(row.contactName) ? row.contactName : null,
      senderName: row.senderName?.trim() || this.inferGroupSenderNameFromBody(row.body) || null,
      messageAt: row.messageAt.toISOString(),
      leadId: row.leadId,
      mediaKind: row.mediaKind,
      hasMedia: Boolean(row.mediaKind && (row.mediaPayload || row.mediaStoragePath)),
    }));
  }

  async applyPushNamesFromPayload(instanceId: string, data: unknown): Promise<number> {
    const parsed = parseEvolutionMessagePayload(data);
    const bestNameByKey = new Map<string, string>();
    const jidByKey = new Map<string, string>();

    for (const message of parsed) {
      if (message.isGroup) {
        const subject = message.groupName?.trim();
        if (isPlausibleGroupTitle(subject)) {
          const prev = bestNameByKey.get(message.contactKey);
          if (!prev || subject!.length > prev.length) {
            bestNameByKey.set(message.contactKey, subject!);
          }
        }
        if (message.remoteJid) jidByKey.set(message.contactKey, message.remoteJid);
        continue;
      }
      if (message.pushName && !message.fromMe && isHumanContactName(message.pushName)) {
        const prev = bestNameByKey.get(message.contactKey);
        if (!prev || message.pushName.length > prev.length) {
          bestNameByKey.set(message.contactKey, message.pushName.trim());
        }
      }
      if (message.remoteJid) jidByKey.set(message.contactKey, message.remoteJid);
    }

    let updated = 0;
    for (const [contactKey, name] of bestNameByKey) {
      if (!isGroupContactKey(contactKey)) {
        const patch = await this.messages.update({ instanceId, contactPhone: contactKey }, { contactName: name });
        updated += patch.affected ?? 0;
      }
      await this.upsertContactProfile({
        instanceId,
        contactKey,
        displayName: name,
        phoneLabel: formatPhoneLenient(contactKey),
        remoteJid: jidByKey.get(contactKey) ?? null,
      });
    }
    return updated;
  }

  async backfillNamesFromStoredMessages(instanceId: string): Promise<void> {
    const rows = await this.messages.find({
      where: { instanceId },
      select: ['contactPhone', 'contactName', 'direction'],
      order: { messageAt: 'DESC' },
      take: 5000,
    });

    const bestInbound = new Map<string, string>();
    for (const row of rows) {
      if (isGroupContactKey(row.contactPhone)) continue;
      if (row.direction !== 'in' || !isHumanContactName(row.contactName)) continue;
      if (!bestInbound.has(row.contactPhone)) {
        bestInbound.set(row.contactPhone, row.contactName!.trim());
      }
    }

    for (const [contactKey, name] of bestInbound) {
      await this.messages.update({ instanceId, contactPhone: contactKey }, { contactName: name });
      await this.upsertContactProfile({
        instanceId,
        contactKey,
        displayName: name,
        phoneLabel: formatPhoneLenient(contactKey),
        remoteJid: (await this.loadLatestRemoteJids(instanceId)).get(contactKey) ?? null,
      });
    }
  }

  private findContactProfileForAvatar(
    instanceId: string,
    contactKey: string,
    profileRows: EvolutionContactProfile[],
    leadId?: string | null,
  ): EvolutionContactProfile | null {
    const forInstance = profileRows.filter((row) => row.instanceId === instanceId);
    const hasStored = (row: EvolutionContactProfile) => Boolean(row.avatarStoragePath);

    const exactStored = forInstance.find((row) => row.contactKey === contactKey && hasStored(row));
    if (exactStored) return exactStored;

    if (leadId) {
      const byLead = forInstance.find((row) => row.leadId === leadId && hasStored(row));
      if (byLead) return byLead;
    }

    const resolved = this.resolveContactProfile(forInstance, instanceId, contactKey);
    if (resolved?.avatarStoragePath) return resolved;

    const anyStored = forInstance.find((row) => hasStored(row));
    if (anyStored && leadId && anyStored.leadId === leadId) return anyStored;

    const exact = forInstance.find((row) => row.contactKey === contactKey);
    if (exact?.avatarUrl?.startsWith('http')) return exact;
    if (resolved?.avatarUrl?.startsWith('http')) return resolved;

    return exact ?? resolved ?? null;
  }

  private async findContactProfileForAvatarByKey(
    instanceId: string,
    contactKey: string,
  ): Promise<EvolutionContactProfile | null> {
    const keys = await this.resolveThreadContactKeys(instanceId, contactKey);
    const profiles = await this.contactProfiles.find({
      where: { instanceId, contactKey: In(keys) },
    });
    const withStorage = profiles.find((row) => row.avatarStoragePath);
    if (withStorage) return withStorage;

    const exact = await this.contactProfiles.findOne({ where: { instanceId, contactKey } });
    if (exact?.avatarStoragePath || exact?.avatarUrl?.startsWith('http')) return exact;

    if (exact?.leadId) {
      const byLead = await this.contactProfiles.findOne({
        where: { instanceId, leadId: exact.leadId },
      });
      if (byLead?.avatarStoragePath || byLead?.avatarUrl?.startsWith('http')) return byLead;
    }

    const all = await this.contactProfiles.find({ where: { instanceId } });
    return this.findContactProfileForAvatar(instanceId, contactKey, all, exact?.leadId);
  }

  private resolveContactProfile(
    profiles: EvolutionContactProfile[],
    instanceId: string,
    contactKey: string,
  ): EvolutionContactProfile | null {
    const exact = profiles.find(
      (row) => row.instanceId === instanceId && row.contactKey === contactKey,
    );
    if (exact) return exact;

    const digits = contactKey.replace(/\D/g, '');
    if (!digits) return null;

    return (
      profiles.find((row) => {
        if (row.instanceId !== instanceId) return false;
        const keyDigits = row.contactKey.replace(/\D/g, '');
        if (keyDigits && keyDigits === digits) return true;
        if (keyDigits.length >= 8 && digits.endsWith(keyDigits.slice(-8))) return true;
        const phoneDigits = row.phoneLabel?.replace(/\D/g, '') ?? '';
        return phoneDigits.length >= 8 && digits.endsWith(phoneDigits.slice(-8));
      }) ?? null
    );
  }

  async backfillMessageMediaFromPayload(instanceId: string, data: unknown): Promise<number> {
    const parsed = parseEvolutionMessagePayload(data);
    let updated = 0;
    for (const msg of parsed) {
      if (!msg.mediaKind || !msg.mediaPayload) continue;
      const patch: Partial<EvolutionMessage> = {
        mediaKind: msg.mediaKind,
        mediaPayload: msg.mediaPayload,
        mediaMimeType: msg.mediaMimeType,
      };
      if (msg.text?.trim()) patch.body = msg.text.slice(0, 2000);
      const byId = await this.messages.update({ instanceId, externalId: msg.externalId }, patch);
      updated += byId.affected ?? 0;
    }
    return updated;
  }

  async ensureThreadProfilesFromMessages(instanceId: string): Promise<number> {
    const keys = await this.messages
      .createQueryBuilder('m')
      .select('DISTINCT m.contact_phone', 'contactKey')
      .where('m.instance_id = :instanceId', { instanceId })
      .getRawMany<{ contactKey: string }>();
    const jidByKey = await this.loadLatestRemoteJids(instanceId);

    let created = 0;
    for (const row of keys) {
      const contactKey = String(row.contactKey ?? '').trim();
      if (!contactKey) continue;
      const existing = await this.contactProfiles.findOne({
        where: { instanceId, contactKey },
        select: ['id'],
      });
      if (existing) continue;
      await this.upsertContactProfile({
        instanceId,
        contactKey,
        displayName: isGroupContactKey(contactKey)
          ? groupLabelFromKey(contactKey)
          : contactLabelFromKey(contactKey),
        phoneLabel: formatPhoneLenient(contactKey),
        remoteJid: jidByKey.get(contactKey) ?? null,
      });
      created += 1;
    }
    return created;
  }

  async syncContactNamesFromEvolution(
    instanceId: string,
  ): Promise<{ updated: number; avatars: number; avatarsStored: number }> {
    await this.ensureThreadProfilesFromMessages(instanceId);
    await this.messages.update({ instanceId, direction: 'out' }, { contactName: null });
    await this.backfillNamesFromStoredMessages(instanceId);
    const lidAliases = await this.remoteContacts.fetchLidPhoneAliases(instanceId);
    await this.reconcileLidContactPhones(instanceId, lidAliases);
    let profiles = await this.remoteContacts.fetchContactProfiles(instanceId);
    const jidByContactKey = await this.loadLatestRemoteJids(instanceId);
    const storedKeys = await this.messages
      .createQueryBuilder('m')
      .select('DISTINCT m.contact_phone', 'contactKey')
      .where('m.instance_id = :instanceId', { instanceId })
      .getRawMany<{ contactKey: string }>();

    const known = new Set(profiles.map((row) => row.contactKey));
    for (const row of storedKeys) {
      const key = String(row.contactKey ?? '').trim();
      if (!key) continue;
      const remoteJid = jidByContactKey.get(key) ?? null;
      if (known.has(key)) {
        const existing = profiles.find((item) => item.contactKey === key);
        if (existing && !existing.remoteJid && remoteJid) existing.remoteJid = remoteJid;
        continue;
      }
      known.add(key);
      profiles.push({
        contactKey: key,
        displayName: contactLabelFromKey(key),
        phoneLabel: formatPhoneLenient(key),
        avatarUrl: null,
        remoteJid,
      });
    }

    const withoutAvatarInDb = await this.contactProfiles.find({
      where: { instanceId },
      select: ['contactKey', 'displayName', 'phoneLabel', 'remoteJid', 'avatarUrl', 'avatarStoragePath'],
    });
    for (const row of withoutAvatarInDb) {
      if (row.avatarStoragePath) continue;
      const existing = profiles.find((item) => item.contactKey === row.contactKey);
      if (existing) {
        if (!existing.remoteJid) existing.remoteJid = row.remoteJid ?? jidByContactKey.get(row.contactKey) ?? null;
        continue;
      }
      profiles.push({
        contactKey: row.contactKey,
        displayName: row.displayName,
        phoneLabel: row.phoneLabel,
        avatarUrl: null,
        remoteJid: row.remoteJid ?? jidByContactKey.get(row.contactKey) ?? null,
      });
    }

    for (const profile of profiles) {
      if (!profile.remoteJid) {
        profile.remoteJid = jidByContactKey.get(profile.contactKey) ?? null;
      }
    }

    profiles = await this.remoteContacts.enrichAvatars(instanceId, profiles, 400);

    let updated = 0;
    let avatars = 0;
    let avatarsStored = 0;
    for (const entry of profiles) {
      const contactKey = String(entry.contactKey ?? '').trim();
      if (!contactKey || contactKey === 'unknown') continue;

      if (entry.avatarUrl) avatars += 1;
      await this.upsertContactProfile({
        instanceId,
        contactKey,
        displayName: entry.displayName,
        phoneLabel: entry.phoneLabel,
        remoteJid: entry.remoteJid,
        avatarUrl: entry.avatarUrl,
      });
      if (entry.avatarUrl) {
        const stored = await this.contactAvatars.persistProfileAvatar(
          instanceId,
          contactKey,
          entry.avatarUrl,
        );
        if (stored) avatarsStored += 1;
      }
      if (isHumanContactName(entry.displayName)) {
        const result = await this.messages.update(
          { instanceId, contactPhone: contactKey },
          { contactName: entry.displayName },
        );
        updated += result.affected ?? 0;
      }
      const [withLead] = await this.messages.find({
        where: { instanceId, contactPhone: contactKey },
        select: ['id', 'leadId'],
        order: { messageAt: 'DESC' },
        take: 1,
      });
      if (withLead?.leadId) {
        if (isHumanContactName(entry.displayName)) {
          await this.commercialLeads.enrichLeadFromWhatsAppInbox(withLead.leadId, entry.displayName);
        }
        const normalizedKey = normalizeMobilePhone(contactKey);
        if (isValidMobilePhone(normalizedKey)) {
          await this.commercialLeads.enrichLeadPhoneFromWhatsAppInbox(withLead.leadId, normalizedKey);
        }
        await this.contactProfiles.update(
          { instanceId, contactKey },
          { leadId: withLead.leadId },
        );
      }
    }
    avatarsStored += await this.contactAvatars.persistMissingAvatarsForInstance(instanceId);
    const avatarRefresh = await this.contactAvatars.refreshAvatarsDetectingChanges(instanceId);
    avatarsStored += avatarRefresh.updated;
    await this.backfillLinkedLeadIdentities(instanceId);
    await this.repairAvatarProfileLinks(instanceId);
    await this.backfillGroupThreadNames(instanceId);
    await this.backfillMessageBodiesFromPayload(instanceId);
    return { updated, avatars, avatarsStored };
  }

  async backfillGroupThreadNames(instanceId: string): Promise<number> {
    const remoteProfiles = await this.remoteContacts.fetchContactProfiles(instanceId);
    let updated = 0;
    const remoteByKey = new Map(
      remoteProfiles
        .filter((entry) => isGroupContactKey(entry.contactKey))
        .map((entry) => [entry.contactKey, entry]),
    );

    for (const entry of remoteProfiles) {
      if (!isGroupContactKey(entry.contactKey)) continue;
      const title =
        evolutionGroupSubjectTitle(entry.displayName) ??
        (isPlausibleGroupTitle(entry.displayName) ? entry.displayName : null);
      if (!title) continue;

      await this.upsertContactProfile({
        instanceId,
        contactKey: entry.contactKey,
        displayName: title,
        phoneLabel: entry.phoneLabel,
        remoteJid: entry.remoteJid,
        avatarUrl: entry.avatarUrl,
      });
      updated += 1;
    }

    const groupProfiles = await this.contactProfiles.find({
      where: { instanceId },
    });

    for (const profile of groupProfiles) {
      if (!isGroupContactKey(profile.contactKey)) continue;
      const remote = remoteByKey.get(profile.contactKey);
      const remoteTitle = remote && isPlausibleGroupTitle(remote.displayName) ? remote.displayName : null;
      const currentTitle = isPlausibleGroupTitle(profile.displayName) ? profile.displayName : null;
      const contaminated =
        Boolean(profile.displayName?.trim()) &&
        (isLikelyParticipantName(profile.displayName) || !isPlausibleGroupTitle(profile.displayName));
      if (!contaminated && currentTitle) continue;

      const nextTitle =
        remoteTitle ??
        currentTitle ??
        pickBestGroupThreadName([remote?.displayName, profile.displayName], profile.contactKey);

      if (nextTitle !== profile.displayName) {
        profile.displayName = nextTitle;
        await this.contactProfiles.save(profile);
        updated += 1;
      }
    }

    return updated;
  }

  async backfillMessageBodiesFromPayload(instanceId: string, limit = 2000): Promise<number> {
    const rows = await this.messages.find({
      where: { instanceId },
      order: { messageAt: 'DESC' },
      take: limit,
    });

    let updated = 0;
    for (const row of rows) {
      if (!this.isInboxBodyPlaceholder(row.body)) continue;
      const recovered = this.extractBodyTextFromStoredMessage(row);
      if (!recovered || recovered === row.body) continue;
      await this.messages.update({ id: row.id }, { body: recovered.slice(0, 2000) });
      updated += 1;
    }
    return updated;
  }

  /** Copia metadados de avatar para perfis do mesmo lead (ex.: telefone perdeu path ao fundir LID). */
  async repairAvatarProfileLinks(instanceId: string): Promise<number> {
    const profiles = await this.contactProfiles.find({ where: { instanceId } });
  const byLead = new Map<string, EvolutionContactProfile[]>();

    for (const row of profiles) {
      if (!row.leadId) continue;
      const bucket = byLead.get(row.leadId) ?? [];
      bucket.push(row);
      byLead.set(row.leadId, bucket);
    }

    let fixed = 0;
    for (const group of byLead.values()) {
      const source = group.find((row) => row.avatarStoragePath);
      if (!source) continue;
      for (const target of group) {
        if (target.id === source.id || target.avatarStoragePath) continue;
        await this.contactProfiles.update(
          { id: target.id },
          {
            avatarStoragePath: source.avatarStoragePath,
            avatarContentHash: source.avatarContentHash,
            avatarSourceFingerprint: source.avatarSourceFingerprint,
            avatarCheckedAt: source.avatarCheckedAt,
          },
        );
        fixed += 1;
      }
    }
    return fixed;
  }

  async refreshContactAvatars(instanceId: string) {
    const outcome = await this.contactAvatars.refreshAvatarsDetectingChanges(instanceId);
    await this.repairAvatarProfileLinks(instanceId);
    return outcome;
  }

  async syncMessageMediaToStorage(instanceId: string, max = 500) {
    return this.messageMediaStorage.persistMissingMediaForInstance(instanceId, max);
  }

  private async backfillLinkedLeadIdentities(instanceId: string): Promise<void> {
    const profiles = await this.contactProfiles.find({
      where: { instanceId },
      select: ['leadId', 'displayName', 'contactKey', 'phoneLabel'],
    });
    for (const row of profiles) {
      if (!row.leadId) continue;
      if (isHumanContactName(row.displayName)) {
        await this.commercialLeads.enrichLeadFromWhatsAppInbox(row.leadId, row.displayName);
      }
      const normalizedKey = normalizeMobilePhone(row.contactKey);
      if (isValidMobilePhone(normalizedKey)) {
        await this.commercialLeads.enrichLeadPhoneFromWhatsAppInbox(row.leadId, normalizedKey);
      }
    }
  }

  private async reconcileLidContactPhones(
    instanceId: string,
    aliases: Map<string, LidPhoneAlias>,
  ): Promise<void> {
    if (!aliases.size) return;

    const aliasByLidKey = new Map<string, LidPhoneAlias>();
    for (const [key, alias] of aliases) {
      if (key.startsWith('lid:')) aliasByLidKey.set(key, alias);
    }
    if (!aliasByLidKey.size) return;

    const withJid = await this.messages.find({
      where: { instanceId },
      select: ['id', 'contactPhone', 'remoteJid', 'leadId'],
    });
    for (const row of withJid) {
      const jid = String(row.remoteJid ?? '').trim().toLowerCase();
      if (!jid) continue;
      const alias = aliases.get(jid);
      if (!alias || row.contactPhone === alias.phoneContactKey) continue;
      if (!row.contactPhone.startsWith('lid:')) continue;
      if (alias.lidJid && alias.lidJid.toLowerCase() !== jid) continue;
      await this.messages.update(
        { id: row.id },
        { contactPhone: alias.phoneContactKey },
      );
      if (row.leadId && isValidMobilePhone(normalizeMobilePhone(alias.phoneContactKey))) {
        await this.commercialLeads.enrichLeadPhoneFromWhatsAppInbox(
          row.leadId,
          normalizeMobilePhone(alias.phoneContactKey),
        );
      }
    }

    for (const [lidKey, alias] of aliasByLidKey) {
      const lidProfile = await this.contactProfiles.findOne({
        where: { instanceId, contactKey: lidKey },
      });
      if (!lidProfile) continue;

      await this.upsertContactProfile({
        instanceId,
        contactKey: alias.phoneContactKey,
        displayName: alias.displayName,
        phoneLabel: alias.phoneLabel,
        remoteJid: lidProfile.remoteJid,
        avatarUrl: lidProfile.avatarUrl,
        leadId: lidProfile.leadId,
      });

      const phoneProfile = await this.contactProfiles.findOne({
        where: { instanceId, contactKey: alias.phoneContactKey },
      });
      if (phoneProfile && lidProfile.avatarStoragePath && !phoneProfile.avatarStoragePath) {
        phoneProfile.avatarStoragePath = lidProfile.avatarStoragePath;
        phoneProfile.avatarContentHash = lidProfile.avatarContentHash;
        phoneProfile.avatarSourceFingerprint = lidProfile.avatarSourceFingerprint;
        phoneProfile.avatarCheckedAt = lidProfile.avatarCheckedAt;
        if (!phoneProfile.avatarUrl && lidProfile.avatarUrl) {
          phoneProfile.avatarUrl = lidProfile.avatarUrl;
        }
        await this.contactProfiles.save(phoneProfile);
      }

      await this.contactProfiles.delete({ instanceId, contactKey: lidKey });
    }
  }

  private async loadLatestRemoteJids(instanceId: string): Promise<Map<string, string>> {
    const rows = await this.messages.find({
      where: { instanceId },
      select: ['contactPhone', 'remoteJid'],
      order: { messageAt: 'DESC' },
      take: 5000,
    });
    const map = new Map<string, string>();
    for (const row of rows) {
      const jid = row.remoteJid?.trim();
      if (!jid || map.has(row.contactPhone)) continue;
      map.set(row.contactPhone, jid);
    }
    return map;
  }

  async streamContactAvatar(
    instanceId: string,
    contactKey: string,
  ): Promise<{ buffer: Buffer; mime: string }> {
    const profile = await this.findContactProfileForAvatarByKey(instanceId, contactKey);
    if (profile?.avatarStoragePath) {
      try {
        return await this.contactAvatars.readStoredAvatar(profile.avatarStoragePath);
      } catch {
        /* tenta URL remota abaixo */
      }
    }

    if (!profile?.avatarUrl?.startsWith('http')) {
      throw new NotFoundException(
        'Avatar ainda não está no storage. Use «Atualizar fotos» ou «Sincronizar».',
      );
    }

    const response = await fetch(profile.avatarUrl);
    if (!response.ok) throw new NotFoundException('Avatar não encontrado no storage.');
    const buffer = Buffer.from(await response.arrayBuffer());
    const mime = response.headers.get('content-type')?.trim() || 'image/jpeg';
    return { buffer, mime };
  }

  async getMessageMedia(
    messageId: string,
  ): Promise<{ buffer: Buffer; mime: string; fileName?: string }> {
    const row = await this.messages.findOne({
      where: { id: messageId },
      select: [
        'id',
        'instanceId',
        'mediaKind',
        'mediaPayload',
        'mediaMimeType',
        'mediaStoragePath',
      ],
    });
    if (!row?.mediaKind) {
      throw new NotFoundException('Esta mensagem não possui mídia.');
    }

    if (row.mediaStoragePath) {
      try {
        return await this.messageMediaStorage.readStoredMedia(
          row.mediaStoragePath,
          row.mediaMimeType,
        );
      } catch {
        // tenta regravar a partir do payload/Evolution
      }
    }

    if (!row.mediaPayload?.trim()) {
      throw new NotFoundException('Mídia ainda não está no storage. Use «Sincronizar».');
    }

    const fetched = await this.remoteMedia.fetchStoredMessageMedia(row.instanceId, {
      payloadJson: row.mediaPayload,
      mimeType: row.mediaMimeType,
      kind: row.mediaKind,
    });

    this.queueMessageMediaPersist(row.id, { force: true });
    return fetched;
  }
}
