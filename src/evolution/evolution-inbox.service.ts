import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CommercialLeadsService } from '../commercial/commercial-leads.service';
import { CommercialLead } from '../commercial/commercial-lead.entity';
import { EvolutionInstance } from './evolution-instance.entity';
import { EvolutionMessage } from './evolution-message.entity';
import { EvolutionInboxRead } from './evolution-inbox-read.entity';
import { EvolutionInboxDeviceRead } from './evolution-inbox-device-read.entity';
import { EvolutionInboxThreadArchive } from './evolution-inbox-thread-archive.entity';
import { EvolutionInboxSyncState } from './evolution-inbox-sync-state.entity';
import {
  collectEvolutionChatRows,
  extractArchiveHintsFromPayload,
  readChatArchived,
  readChatReadTimestamp,
  readChatUnreadCount,
} from './evolution-chat.parser';
import {
  EvolutionRemoteChatsService,
  type EvolutionRemoteChatRow,
} from './evolution-remote-chats.service';
import { EvolutionRemoteMessagesService } from './evolution-remote-messages.service';
import { User, UserRole, userHasRole } from '../users/user.entity';
import {
  contactLabelFromKey,
  extractGroupSubjectFromRecord,
  formatPhoneLenient,
  groupLabelFromKey,
  isGroupContactKey,
  evolutionGroupSubjectTitle,
  isGenericInboxLabel,
  isGenericGroupThreadName,
  isLikelyParticipantName,
  isPlausibleGroupTitle,
  pickBestGroupThreadName,
  isHumanContactName,
  pickBestThreadContactName,
  resolveEvolutionContact,
  resolveInboxContactPresentation,
  stripEmojiForNameHeuristic,
} from './evolution-contact.resolver';
import {
  parseEvolutionMessagePayload,
  parseMessageDeliveryUpdates,
  resolveContactFromEvolutionPayload,
} from './evolution-message.parser';
import { phoneFromSenderPn } from './evolution-contact.resolver';
import {
  bodyTextFromWhatsAppMessage,
  extractQuotedPreviewFromStoredPayload,
  externalMessageIdsMatch,
  extractDeliveryStatusFromStoredPayload,
  mergeDeliveryStatusIntoPayload,
  type MessageDeliveryAck,
  normalizeWhatsAppDeliveryStatus,
  extractReactionTargetFromPayloadJson,
  isReactionPlaceholderBody,
  reactionEmojiFromPlaceholderBody,
  resolveMessageEnvelope,
  type WhatsAppQuotedPreview,
} from './evolution-message-media';
import { EvolutionRemoteMediaService } from './evolution-remote-media.service';
import { EvolutionRemoteContactsService } from './evolution-remote-contacts.service';
import { EvolutionContactProfile } from './evolution-contact-profile.entity';
import { EvolutionContactAvatarService } from './evolution-contact-avatar.service';
import { EvolutionInboxRealtimeService } from './evolution-inbox-realtime.service';
import { EvolutionMessageMediaStorageService } from './evolution-message-media-storage.service';
import type { LidPhoneAlias } from './evolution-remote-contacts.service';
import { normalizeMobilePhone, isValidMobilePhone } from '../users/person.utils';
import { resolveYouTubeVideoId } from './youtube-link';

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
  isReaction?: boolean;
  reactionTargetExternalId?: string | null;
  reactionRemove?: boolean;
  deliveryStatus?: MessageDeliveryAck | null;
};

const INBOX_BOOTSTRAP_CHAT_LIMIT = 50;
const INBOX_BOOTSTRAP_MESSAGES_PER_CHAT = 10;
const INBOX_BOOTSTRAP_AVATAR_LIMIT = 150;
const INBOX_BOOTSTRAP_CHAT_CONCURRENCY = 4;

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
  isArchived: boolean;
};

export type EvolutionInboxThreadsPageDto = {
  threads: EvolutionInboxThreadDto[];
  hasMore: boolean;
  limit: number;
  offset: number;
};

const INBOX_THREADS_PAGE_DEFAULT = 45;
const INBOX_THREADS_PAGE_MAX = 100;
const INBOX_WEBHOOK_HEALTH_MS = 25 * 60_000;
const INBOX_THREAD_PULL_THROTTLE_MS = 90_000;
const INBOX_THREAD_PULL_THROTTLE_HEALTHY_MS = 12 * 60_000;
const INBOX_DELTA_OVERLAP_MS = 2 * 60_000;
const INBOX_CHAT_READ_SYNC_MS = 90_000;

export type EvolutionInboxMessageReactionDto = {
  emoji: string;
  senderName: string | null;
  direction: 'in' | 'out';
};

export type EvolutionInboxMessageQuoteDto = {
  author: string | null;
  body: string;
  mediaKind: string | null;
};

export type EvolutionInboxInstanceOptionDto = {
  id: string;
  name: string;
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
  reactions: EvolutionInboxMessageReactionDto[];
  quote: EvolutionInboxMessageQuoteDto | null;
  deliveryStatus: MessageDeliveryAck | null;
};

@Injectable()
export class EvolutionInboxService {
  private readonly groupTitleRefreshAt = new Map<string, number>();
  private readonly remoteGroupTitleCache = new Map<
    string,
    { at: number; titles: Map<string, string> }
  >();
  private readonly chatArchiveSyncAt = new Map<string, number>();
  private readonly chatReadSyncAt = new Map<string, number>();
  private readonly threadRemotePullAt = new Map<string, number>();
  private readonly backgroundMaintenanceAt = new Map<string, number>();
  private readonly connectBootstrapAt = new Map<string, number>();
  private readonly connectBootstrapInFlight = new Set<string>();

  constructor(
    @InjectRepository(EvolutionMessage)
    private readonly messages: Repository<EvolutionMessage>,
    @InjectRepository(EvolutionInboxRead)
    private readonly inboxReads: Repository<EvolutionInboxRead>,
    @InjectRepository(EvolutionInboxDeviceRead)
    private readonly deviceReads: Repository<EvolutionInboxDeviceRead>,
    @InjectRepository(EvolutionInboxThreadArchive)
    private readonly threadArchives: Repository<EvolutionInboxThreadArchive>,
    @InjectRepository(EvolutionInboxSyncState)
    private readonly inboxSyncState: Repository<EvolutionInboxSyncState>,
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
    private readonly remoteChats: EvolutionRemoteChatsService,
    private readonly remoteMessages: EvolutionRemoteMessagesService,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  private queueMessageMediaPersist(messageId: string, options?: { force?: boolean }) {
    this.messageMediaStorage.enqueuePersistMessageMedia(messageId, options);
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

    if (parsed.isReaction && parsed.reactionTargetExternalId) {
      return this.ingestReactionMessage(instance, parsed);
    }

    if (isReactionPlaceholderBody(parsed.text)) {
      return { leadId: null, created: false, messageId: null, ingested: false };
    }

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
          [
            evolutionGroupSubjectTitle(parsed.groupName) ?? parsed.groupName,
          ],
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
      if (parsed.mediaPayload?.trim()) {
        messagePatch.mediaPayload = parsed.mediaPayload;
      }
      if (parsed.deliveryStatus) {
        messagePatch.deliveryStatus = parsed.deliveryStatus;
        if (parsed.mediaPayload?.trim()) {
          messagePatch.mediaPayload = mergeDeliveryStatusIntoPayload(
            parsed.mediaPayload,
            parsed.deliveryStatus,
          );
        } else if (duplicate.mediaPayload?.trim()) {
          messagePatch.mediaPayload = mergeDeliveryStatusIntoPayload(
            duplicate.mediaPayload,
            parsed.deliveryStatus,
          );
        }
      }
      if (
        parsed.mediaPayload?.trim() &&
        extractQuotedPreviewFromStoredPayload(parsed.mediaPayload) &&
        !messagePatch.mediaPayload
      ) {
        messagePatch.mediaPayload = parsed.mediaPayload;
      }
      if (parsed.mediaKind && parsed.mediaPayload) {
        messagePatch.mediaKind = parsed.mediaKind;
        messagePatch.mediaMimeType = parsed.mediaMimeType;
        messagePatch.mediaStoragePath = null;
        messagePatch.mediaContentHash = null;
        messagePatch.mediaStoredAt = null;
        if (parsed.text?.trim()) messagePatch.body = parsed.text.slice(0, 2000);
      } else if (parsed.text?.trim() && extractQuotedPreviewFromStoredPayload(parsed.mediaPayload)) {
        messagePatch.body = parsed.text.slice(0, 2000);
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
      const threadKey =
        (await this.rekeyThreadToPhoneIfKnown(instance.id, parsed.contactKey, parsed.mediaPayload)) ??
        parsed.contactKey;
      await this.publishInboxActivity(instance.id, threadKey, duplicate.id, false);
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
        deliveryStatus:
          parsed.deliveryStatus ?? (parsed.fromMe ? 'sent' : null),
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

    const threadKey =
      (await this.rekeyThreadToPhoneIfKnown(instance.id, parsed.contactKey, parsed.mediaPayload)) ??
      parsed.contactKey;
    await this.publishInboxActivity(instance.id, threadKey, saved.id, true);
    void this.bumpLocalMessageWatermark(instance.id, parsed.messageAt);
    return { leadId, created, messageId: saved.id, ingested: true };
  }

  private inboxSyncStateReady(): boolean {
    try {
      void this.inboxSyncState.metadata.tableName;
      return true;
    } catch {
      return false;
    }
  }

  async recordWebhookDelivery(instanceId: string): Promise<void> {
    const id = String(instanceId ?? '').trim();
    if (!id || !this.inboxSyncStateReady()) return;
    const now = new Date();
    let state = await this.inboxSyncState.findOne({ where: { instanceId: id } });
    if (!state) {
      state = this.inboxSyncState.create({ instanceId: id, lastWebhookAt: now });
    } else {
      state.lastWebhookAt = now;
    }
    await this.inboxSyncState.save(state);
  }

  async getInstanceLatestMessageAt(instanceId: string): Promise<Date | null> {
    const row = await this.messages
      .createQueryBuilder('m')
      .select('MAX(m.message_at)', 'maxAt')
      .where('m.instance_id = :instanceId', { instanceId })
      .getRawOne<{ maxAt: Date | string | null }>();
    const raw = row?.maxAt;
    if (!raw) return null;
    const at = raw instanceof Date ? raw : new Date(raw);
    return Number.isNaN(at.getTime()) ? null : at;
  }

  async isInstanceWebhookHealthy(instanceId: string): Promise<boolean> {
    if (!this.inboxSyncStateReady()) return false;
    try {
      const state = await this.inboxSyncState.findOne({
        where: { instanceId },
        select: ['lastWebhookAt'],
      });
      if (!state?.lastWebhookAt) return false;
      return Date.now() - state.lastWebhookAt.getTime() < INBOX_WEBHOOK_HEALTH_MS;
    } catch {
      return false;
    }
  }

  private async bumpLocalMessageWatermark(instanceId: string, messageAt: Date): Promise<void> {
    const at = messageAt instanceof Date && !Number.isNaN(messageAt.getTime()) ? messageAt : null;
    if (!at || !this.inboxSyncStateReady()) return;
    let state = await this.inboxSyncState.findOne({ where: { instanceId } });
    if (!state) {
      state = this.inboxSyncState.create({
        instanceId,
        lastLocalMessageAt: at,
      });
    } else if (!state.lastLocalMessageAt || at > state.lastLocalMessageAt) {
      state.lastLocalMessageAt = at;
    }
    await this.inboxSyncState.save(state).catch(() => {});
  }

  private async latestMessageAtForContactKeys(
    instanceId: string,
    contactKeys: string[],
  ): Promise<Date | null> {
    const keys = [...new Set(contactKeys.map((k) => String(k ?? '').trim()).filter(Boolean))];
    if (!keys.length) return null;
    const row = await this.messages
      .createQueryBuilder('m')
      .select('MAX(m.message_at)', 'maxAt')
      .where('m.instance_id = :instanceId', { instanceId })
      .andWhere('m.contact_phone IN (:...keys)', { keys })
      .getRawOne<{ maxAt: Date | string | null }>();
    const raw = row?.maxAt;
    if (!raw) return null;
    const at = raw instanceof Date ? raw : new Date(raw);
    return Number.isNaN(at.getTime()) ? null : at;
  }

  private findSiblingForQuotePreview(
    externalId: string | null | undefined,
    siblingsByExternalId: Map<string, EvolutionMessage>,
    siblingRows: EvolutionMessage[],
  ): EvolutionMessage | null {
    const hint = String(externalId ?? '').trim();
    if (!hint) return null;
    if (siblingsByExternalId.has(hint)) return siblingsByExternalId.get(hint)!;
    for (const sibling of siblingRows) {
      if (externalMessageIdsMatch(hint, sibling.externalId)) return sibling;
    }
    for (const row of siblingsByExternalId.values()) {
      if (externalMessageIdsMatch(hint, row.externalId)) return row;
    }
    return null;
  }

  private quoteDtoForRow(
    row: EvolutionMessage,
    siblingsByExternalId?: Map<string, EvolutionMessage>,
    siblingRows?: EvolutionMessage[],
  ): EvolutionInboxMessageQuoteDto | null {
    const preview = extractQuotedPreviewFromStoredPayload(row.mediaPayload);
    if (!preview) return null;
    return this.enrichQuotePreview(
      row,
      preview,
      siblingsByExternalId ?? new Map(),
      siblingRows ?? [...(siblingsByExternalId?.values() ?? [])],
    );
  }

  private enrichQuotePreview(
    row: EvolutionMessage,
    preview: WhatsAppQuotedPreview,
    siblingsByExternalId: Map<string, EvolutionMessage>,
    siblingRows: EvolutionMessage[],
  ): EvolutionInboxMessageQuoteDto {
    let author: string | null = null;
    let body = preview.body.trim();
    const target = this.findSiblingForQuotePreview(
      preview.externalId,
      siblingsByExternalId,
      siblingRows,
    );

    if (target) {
      author =
        target.direction === 'out'
          ? 'Você'
          : target.senderName?.trim() ||
            (isHumanContactName(target.contactName) ? target.contactName?.trim() : null) ||
            null;
      const recovered = this.formatMessageBodyForInbox(target).trim();
      if (recovered) body = recovered.slice(0, 280);
    }

    if (!author && preview.participant) {
      if (preview.participant.includes('@g.us')) {
        author = 'Grupo';
      } else {
        const digits = preview.participant.split('@')[0]?.replace(/\D/g, '') ?? '';
        author = digits ? formatPhoneLenient(digits) : null;
      }
    }

    if (!body) {
      if (preview.mediaKind) {
        body =
          { image: '[imagem]', video: '[vídeo]', audio: '[áudio]', document: '[documento]', sticker: '[figurinha]' }[
            preview.mediaKind
          ] ?? '[mídia]';
      } else if (target) {
        body = '(mensagem)';
      } else if (preview.externalId) {
        body = 'Mensagem citada';
      } else {
        body = '(mensagem)';
      }
    }

    return {
      author,
      body,
      mediaKind: preview.mediaKind,
    };
  }

  private resolveDeliveryStatusForRow(row: EvolutionMessage): MessageDeliveryAck | null {
    if (row.direction !== 'out') return null;
    const stored = row.deliveryStatus
      ? (normalizeWhatsAppDeliveryStatus(row.deliveryStatus) ?? null)
      : null;
    if (stored) return stored;
    return extractDeliveryStatusFromStoredPayload(row.mediaPayload) ?? 'sent';
  }

  private mapMessageRowToDto(
    row: EvolutionMessage,
    reactions: EvolutionInboxMessageReactionDto[] = [],
    quote: EvolutionInboxMessageQuoteDto | null = null,
    siblingRows?: EvolutionMessage[],
  ): EvolutionInboxMessageDto {
    const resolvedQuote =
      quote ??
      (siblingRows?.length
        ? this.quoteDtoForRow(row, undefined, siblingRows)
        : this.quoteDtoForRow(row));
    return {
      id: row.id,
      direction: row.direction,
      body: this.formatMessageBodyForInbox(row),
      contactName: isHumanContactName(row.contactName) ? row.contactName : null,
      senderName: row.senderName?.trim() || this.inferGroupSenderNameFromBody(row.body) || null,
      messageAt: row.messageAt.toISOString(),
      leadId: row.leadId,
      mediaKind: row.mediaKind,
      hasMedia: Boolean(row.mediaKind && (row.mediaPayload || row.mediaStoragePath)),
      reactions,
      quote: resolvedQuote,
      deliveryStatus: this.resolveDeliveryStatusForRow(row),
    };
  }

  private isReactionMessageRow(row: EvolutionMessage): boolean {
    if (row.mediaKind === 'reaction') return true;
    if (row.reactionTargetExternalId?.trim()) return true;
    return isReactionPlaceholderBody(row.body);
  }

  private parseReactionFromRow(row: EvolutionMessage): EvolutionInboxMessageReactionDto | null {
    if (!this.isReactionMessageRow(row)) return null;

    const emoji =
      reactionEmojiFromPlaceholderBody(row.body) ||
      (row.mediaKind === 'reaction' ? String(row.body ?? '').trim() : null);
    if (!emoji || emoji === '(mensagem)') return null;

    return {
      emoji,
      senderName: row.senderName?.trim() || this.inferGroupSenderNameFromBody(row.body) || null,
      direction: row.direction,
    };
  }

  private reactionKeysMatch(targetKey: string, messageExternalId: string): boolean {
    const target = String(targetKey ?? '').trim();
    const external = String(messageExternalId ?? '').trim();
    if (!target || !external) return false;
    if (target === external) return true;
    if (external.endsWith(target) || target.endsWith(external)) return true;
    if (external.includes(target) || target.includes(external)) return true;
    return false;
  }

  private reactionsForMessage(
    externalId: string,
    reactionsByTarget: Map<string, EvolutionInboxMessageReactionDto[]>,
  ): EvolutionInboxMessageReactionDto[] {
    const merged = new Map<string, EvolutionInboxMessageReactionDto>();
    for (const [targetId, list] of reactionsByTarget) {
      if (!this.reactionKeysMatch(targetId, externalId)) continue;
      for (const item of list) {
        const key = `${item.emoji}:${item.senderName ?? ''}:${item.direction}`;
        if (!merged.has(key)) merged.set(key, item);
      }
    }
    return [...merged.values()];
  }

  private reactionTargetExternalIdFromRow(row: EvolutionMessage): string | null {
    const direct = String(row.reactionTargetExternalId ?? '').trim();
    if (direct) return direct;
    return extractReactionTargetFromPayloadJson(row.mediaPayload);
  }

  private buildThreadMessageList(rows: EvolutionMessage[]): EvolutionInboxMessageDto[] {
    const chatRows: EvolutionMessage[] = [];
    const reactionRows: EvolutionMessage[] = [];
    const reactionsByTarget = new Map<string, EvolutionInboxMessageReactionDto[]>();

    for (const row of rows) {
      if (this.isReactionMessageRow(row)) {
        reactionRows.push(row);
        const targetId = this.reactionTargetExternalIdFromRow(row);
        const reaction = this.parseReactionFromRow(row);
        if (reaction && targetId) {
          const bucket = reactionsByTarget.get(targetId) ?? [];
          bucket.push(reaction);
          reactionsByTarget.set(targetId, bucket);
        }
        continue;
      }
      chatRows.push(row);
    }

  for (const orphan of reactionRows) {
      if (this.reactionTargetExternalIdFromRow(orphan)) continue;
      const reaction = this.parseReactionFromRow(orphan);
      if (!reaction) continue;
      const target = [...chatRows]
        .filter((message) => message.messageAt.getTime() <= orphan.messageAt.getTime())
        .sort((a, b) => b.messageAt.getTime() - a.messageAt.getTime())[0];
      if (!target) continue;
      const bucket = reactionsByTarget.get(target.externalId) ?? [];
      bucket.push(reaction);
      reactionsByTarget.set(target.externalId, bucket);
    }

    if (!chatRows.length) {
      throw new NotFoundException('Nenhuma mensagem nesta conversa.');
    }

    const siblingsByExternalId = new Map<string, EvolutionMessage>();
    for (const row of chatRows) {
      const externalId = String(row.externalId ?? '').trim();
      if (externalId) siblingsByExternalId.set(externalId, row);
    }

    return chatRows.map((row) =>
      this.mapMessageRowToDto(
        row,
        this.reactionsForMessage(row.externalId, reactionsByTarget),
        this.quoteDtoForRow(row, siblingsByExternalId, chatRows),
        chatRows,
      ),
    );
  }

  async applyMessageDeliveryUpdates(instanceId: string, data: unknown): Promise<number> {
    const updates = parseMessageDeliveryUpdates(data);
    if (!updates.length) return 0;

    let changed = 0;
    for (const update of updates) {
      if (!update.fromMe) continue;
      let row = await this.messages.findOne({
        where: { instanceId, externalId: update.externalId },
      });
      if (!row) {
        const hint = update.externalId;
        const candidates = await this.messages.find({
          where: { instanceId, direction: 'out' },
          order: { messageAt: 'DESC' },
          take: 400,
          select: ['id', 'externalId', 'contactPhone', 'mediaPayload', 'deliveryStatus'],
        });
        row = candidates.find((item) => externalMessageIdsMatch(hint, item.externalId)) ?? null;
      }
      if (!row) continue;

      const rank: Record<MessageDeliveryAck, number> = {
        pending: 0,
        sent: 1,
        delivered: 2,
        read: 3,
        played: 4,
      };
      const current = row.deliveryStatus
        ? (normalizeWhatsAppDeliveryStatus(row.deliveryStatus) ?? 'sent')
        : extractDeliveryStatusFromStoredPayload(row.mediaPayload) ?? 'sent';
      if (rank[update.status] <= rank[current]) continue;

      const patch: Partial<EvolutionMessage> = { deliveryStatus: update.status };
      if (row.mediaPayload?.trim()) {
        patch.mediaPayload = mergeDeliveryStatusIntoPayload(row.mediaPayload, update.status);
      }
      await this.messages.update({ id: row.id }, patch);
      changed += 1;
      const threadKey =
        (await this.resolveThreadContactKeys(instanceId, row.contactPhone))[0] ?? row.contactPhone;
      await this.publishInboxActivity(instanceId, threadKey, row.id, false);
    }

    if (changed > 0) {
      this.inboxRealtime.notifyThreadsUpdated(instanceId);
    }
    return changed;
  }

  async repairReactionMessages(
    instanceId: string,
    limit = 3000,
    contactPhones?: string[],
  ): Promise<number> {
    const contactFilter = (contactPhones ?? [])
      .map((value) => String(value ?? '').trim())
      .filter(Boolean);
    const rows = await this.messages.find({
      where: {
        instanceId,
        ...(contactFilter.length ? { contactPhone: In(contactFilter) } : {}),
      },
      order: { messageAt: 'DESC' },
      take: limit,
    });

    let updated = 0;
    const byExternal = new Map(rows.map((row) => [row.externalId, row]));

    for (const row of rows) {
      if (!this.isReactionMessageRow(row)) continue;

      const target =
        this.reactionTargetExternalIdFromRow(row) ??
        (() => {
          const prior = rows
            .filter(
              (message) =>
                !this.isReactionMessageRow(message) &&
                message.contactPhone === row.contactPhone &&
                message.messageAt.getTime() <= row.messageAt.getTime(),
            )
            .sort((a, b) => b.messageAt.getTime() - a.messageAt.getTime())[0];
          return prior?.externalId ?? null;
        })();

      const emoji = reactionEmojiFromPlaceholderBody(row.body) || String(row.body ?? '').trim();
      const patch: Partial<EvolutionMessage> = {
        mediaKind: 'reaction',
        body: emoji.slice(0, 2000),
      };
      if (target && !row.reactionTargetExternalId) {
        patch.reactionTargetExternalId = target;
      }

      const shouldUpdate =
        row.mediaKind !== 'reaction' ||
        (target && row.reactionTargetExternalId !== target) ||
        row.body !== patch.body;

      if (!shouldUpdate) continue;

      await this.messages.update({ id: row.id }, patch);
      updated += 1;

      if (target && byExternal.has(target)) {
        /* vínculo persistido */
      }
    }

    return updated;
  }

  private async ingestReactionMessage(
    instance: EvolutionInstance,
    parsed: ParsedEvolutionMessage,
  ): Promise<{
    leadId: string | null;
    created: boolean;
    messageId: string | null;
    ingested: boolean;
  }> {
    const targetId = String(parsed.reactionTargetExternalId ?? '').trim();
    if (!targetId) {
      return { leadId: null, created: false, messageId: null, ingested: false };
    }

    const removePrior = this.messages
      .createQueryBuilder()
      .delete()
      .from(EvolutionMessage)
      .where('instance_id = :instanceId', { instanceId: instance.id })
      .andWhere('media_kind = :kind', { kind: 'reaction' })
      .andWhere('reaction_target_external_id = :targetId', { targetId: targetId });

    if (parsed.senderJid?.trim()) {
      removePrior.andWhere('sender_jid = :senderJid', { senderJid: parsed.senderJid.trim() });
    } else if (parsed.fromMe) {
      removePrior.andWhere("direction = 'out'");
    } else {
      removePrior.andWhere("direction = 'in'").andWhere('(sender_jid IS NULL OR sender_jid = \'\')');
    }
    await removePrior.execute();

    const duplicate = await this.messages.findOne({
      where: { instanceId: instance.id, externalId: parsed.externalId },
    });

    if (parsed.reactionRemove || !parsed.text.trim()) {
      if (duplicate) await this.messages.delete({ id: duplicate.id });
      await this.publishInboxActivity(instance.id, parsed.contactKey, null, true);
      return { leadId: null, created: false, messageId: duplicate?.id ?? null, ingested: true };
    }

    if (duplicate) {
      await this.messages.update(
        { id: duplicate.id },
        {
          body: parsed.text.slice(0, 2000),
          reactionTargetExternalId: targetId,
          mediaKind: 'reaction',
          senderName: parsed.senderName ?? null,
          senderJid: parsed.senderJid ?? null,
        },
      );
      await this.publishInboxActivity(instance.id, parsed.contactKey, duplicate.id, false);
      return { leadId: null, created: false, messageId: duplicate.id, ingested: false };
    }

    const saved = await this.messages.save(
      this.messages.create({
        instanceId: instance.id,
        contactPhone: parsed.contactKey,
        contactName: parsed.isGroup && !parsed.fromMe ? parsed.senderName ?? null : null,
        senderName: parsed.senderName ?? null,
        senderJid: parsed.senderJid ?? null,
        remoteJid: parsed.remoteJid,
        direction: parsed.fromMe ? 'out' : 'in',
        body: parsed.text.slice(0, 2000),
        externalId: parsed.externalId,
        reactionTargetExternalId: targetId,
        leadId: null,
        messageAt: parsed.messageAt,
        mediaKind: 'reaction',
        mediaPayload: parsed.mediaPayload,
        mediaMimeType: null,
      }),
    );

    await this.publishInboxActivity(instance.id, parsed.contactKey, saved.id, true);
    return { leadId: null, created: true, messageId: saved.id, ingested: true };
  }

  /** Contatos não salvos no celular costumam vir como `lid:` até aparecer o telefone no payload. */
  private async rekeyThreadToPhoneIfKnown(
    instanceId: string,
    contactKey: string,
    mediaPayload: string | null | undefined,
  ): Promise<string | null> {
    const fromKey = String(contactKey ?? '').trim();
    if (!fromKey || fromKey === 'unknown') return null;
    if (!fromKey.startsWith('lid:') && isValidMobilePhone(normalizeMobilePhone(fromKey))) return null;

    let phoneKey: string | null = null;
    if (mediaPayload?.trim()) {
      try {
        const payload = JSON.parse(mediaPayload) as unknown;
        const resolved = resolveContactFromEvolutionPayload(payload);
        if (resolved?.phone && isValidMobilePhone(normalizeMobilePhone(resolved.phone))) {
          phoneKey = normalizeMobilePhone(resolved.phone);
        }
      } catch {
        /* ignora */
      }
    }

    if (!phoneKey && mediaPayload?.trim()) {
      try {
        const payload = JSON.parse(mediaPayload) as Record<string, unknown>;
        const key = (payload.key ?? {}) as Record<string, unknown>;
        const senderPn = String(key.senderPn ?? payload.senderPn ?? '').trim();
        const fromPn = phoneFromSenderPn(senderPn);
        if (fromPn && isValidMobilePhone(normalizeMobilePhone(fromPn))) {
          phoneKey = normalizeMobilePhone(fromPn);
        }
      } catch {
        /* ignora */
      }
    }

    if (!phoneKey || phoneKey === fromKey) return null;

    await this.messages.update(
      { instanceId, contactPhone: fromKey },
      { contactPhone: phoneKey },
    );

    const profile = await this.contactProfiles.findOne({ where: { instanceId, contactKey: fromKey } });
    if (profile) {
      await this.upsertContactProfile({
        instanceId,
        contactKey: phoneKey,
        displayName: profile.displayName,
        phoneLabel: formatPhoneLenient(phoneKey),
        remoteJid: profile.remoteJid,
        avatarUrl: profile.avatarUrl,
        leadId: profile.leadId,
      });
      if (profile.leadId) {
        await this.commercialLeads.enrichLeadPhoneFromWhatsAppInbox(profile.leadId, phoneKey);
      }
    }

    void this.remoteContacts
      .fetchLidPhoneAliases(instanceId)
      .then((aliases) => this.reconcileLidContactPhones(instanceId, aliases))
      .catch(() => {});

    return phoneKey;
  }

  private async publishInboxActivity(
    instanceId: string,
    contactKey: string,
    messageId: string | null,
    ingested: boolean,
  ): Promise<void> {
    const contactPhones = await this.resolveThreadContactKeys(instanceId, contactKey);
    let message: EvolutionInboxMessageDto | null = null;
    if (messageId) {
      const row = await this.messages.findOne({ where: { id: messageId } });
      if (row) {
        const hideReactionRow =
          row.mediaKind === 'reaction' ||
          Boolean(row.reactionTargetExternalId?.trim()) ||
          isReactionPlaceholderBody(row.body);
        if (!hideReactionRow) {
          const siblings = await this.messages.find({
            where: { instanceId, contactPhone: row.contactPhone },
            order: { messageAt: 'DESC' },
            take: 160,
          });
          const siblingsByExternalId = new Map<string, EvolutionMessage>();
          for (const sibling of siblings) {
            const externalId = String(sibling.externalId ?? '').trim();
            if (externalId) siblingsByExternalId.set(externalId, sibling);
          }
          message = this.mapMessageRowToDto(
            row,
            [],
            this.quoteDtoForRow(row, siblingsByExternalId),
          );
        } else {
          const targetExternalId = this.reactionTargetExternalIdFromRow(row);
          if (targetExternalId) {
            const targetRow = await this.messages.findOne({
              where: { instanceId, contactPhone: row.contactPhone, externalId: targetExternalId },
            });
            if (targetRow && !this.isReactionMessageRow(targetRow)) {
              const reactionRows = await this.messages.find({
                where: { instanceId, contactPhone: row.contactPhone, mediaKind: 'reaction' },
                order: { messageAt: 'ASC' },
                take: 400,
              });
              const reactionsByTarget = new Map<string, EvolutionInboxMessageReactionDto[]>();
              for (const reactionRow of reactionRows) {
                const targetId = this.reactionTargetExternalIdFromRow(reactionRow);
                const reaction = this.parseReactionFromRow(reactionRow);
                if (!reaction || !targetId) continue;
                const bucket = reactionsByTarget.get(targetId) ?? [];
                bucket.push(reaction);
                reactionsByTarget.set(targetId, bucket);
              }
              message = this.mapMessageRowToDto(
                targetRow,
                this.reactionsForMessage(targetExternalId, reactionsByTarget),
              );
            }
          }
        }
      }
    }
    this.inboxRealtime.notifyThreadActivity({
      instanceId,
      contactPhone: contactKey,
      contactPhones,
      messageId,
      ingested,
      message,
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
      if (
        sender &&
        !this.isWeakGroupSenderLabel(sender) &&
        !body.toLowerCase().startsWith(`${sender.toLowerCase()}:`)
      ) {
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
        const pickGroupTitle = (name: string | null | undefined): string | null => {
          const auth = evolutionGroupSubjectTitle(name);
          if (auth) return auth;
          const trimmed = String(name ?? '').trim();
          if (!trimmed || isLikelyParticipantName(trimmed)) return null;
          return isPlausibleGroupTitle(trimmed) ? trimmed : null;
        };
        const fromInput = pickGroupTitle(input.displayName);
        const fromExisting = pickGroupTitle(existing.displayName);
        nextDisplay = pickBestGroupThreadName([fromInput, fromExisting], contactKey);
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

  private collapseMessageRowsByRemoteJid(rows: EvolutionMessage[]): EvolutionMessage[] {
    const collapsed = new Map<string, EvolutionMessage>();
    for (const latest of rows) {
      const contactPhone = String(latest.contactPhone ?? '').trim();
      const jidRaw = String(latest.remoteJid ?? '').trim().toLowerCase();
      const groupKey = jidRaw
        ? `${latest.instanceId}:jid:${jidRaw}`
        : `${latest.instanceId}:phone:${contactPhone}`;
      const existing = collapsed.get(groupKey);
      if (!existing) {
        collapsed.set(groupKey, latest);
        continue;
      }
      const newer =
        latest.messageAt.getTime() >= existing.messageAt.getTime() ? latest : existing;
      const older = newer === latest ? existing : latest;
      const canonicalPhone = this.pickCanonicalContactKey(newer.contactPhone, older.contactPhone);
      collapsed.set(groupKey, { ...newer, contactPhone: canonicalPhone });
    }
    return [...collapsed.values()];
  }

  private async resolveOwnerUserId(instance: EvolutionInstance): Promise<string> {
    if (instance.defaultOwnerUserId) {
      const user = await this.users.findOne({
        where: { id: instance.defaultOwnerUserId, active: true },
        select: ['id'],
      });
      if (user) return user.id;
    }
    const rows = await this.users.find({ where: { active: true }, order: { createdAt: 'ASC' }, take: 50 });
    const admin = rows.find((user) => userHasRole(user, UserRole.ADMIN));
    if (admin) return admin.id;
    if (rows[0]) return rows[0].id;
    throw new NotFoundException('Nenhum usuário disponível para sincronizar mensagens.');
  }

  private async pullRemoteMessagesForThreadIfDue(
    instanceId: string,
    contactKey: string,
    options?: { force?: boolean },
  ): Promise<void> {
    const throttleKey = `${instanceId}:${contactKey}`;
    const last = this.threadRemotePullAt.get(throttleKey) ?? 0;
    const webhookHealthy = await this.isInstanceWebhookHealthy(instanceId);
    const throttleMs = webhookHealthy ? INBOX_THREAD_PULL_THROTTLE_HEALTHY_MS : INBOX_THREAD_PULL_THROTTLE_MS;
    if (!options?.force && Date.now() - last < throttleMs) return;
    this.threadRemotePullAt.set(throttleKey, Date.now());

    const instance = await this.instances.findOne({
      where: { id: instanceId, active: true },
      select: ['id', 'name', 'defaultOwnerUserId', 'autoCreateLeads'],
    });
    if (!instance) return;

    const keys = await this.resolveThreadContactKeys(instanceId, contactKey);
    const localWatermark = await this.latestMessageAtForContactKeys(instanceId, keys);
    const deltaSince = localWatermark
      ? new Date(localWatermark.getTime() - INBOX_DELTA_OVERLAP_MS)
      : null;
    let remoteJid = await this.resolveRemoteJidForContact(instanceId, contactKey);
    if (!remoteJid) {
      for (const alias of keys) {
        remoteJid = await this.resolveRemoteJidForContact(instanceId, alias);
        if (remoteJid) break;
      }
    }
    const jidCandidates = new Set<string>();
    if (remoteJid) jidCandidates.add(remoteJid);
    const digits = normalizeMobilePhone(contactKey);
    if (isValidMobilePhone(digits)) {
      jidCandidates.add(`${digits}@s.whatsapp.net`);
      jidCandidates.add(`55${digits}@s.whatsapp.net`);
      jidCandidates.add(`${digits}@c.us`);
    }
    if (contactKey.startsWith('lid:')) {
      const lid = contactKey.slice(4).replace(/\D/g, '');
      if (lid) jidCandidates.add(`${lid}@lid`);
    }

    const fetchLimit = deltaSince ? 55 : localWatermark ? 40 : 80;
    const parsedMap = new Map<string, ParsedEvolutionMessage>();
    for (const jid of jidCandidates) {
      const payload = await this.remoteMessages.fetchMessagesForJid(instanceId, jid, fetchLimit, {
        since: deltaSince ?? undefined,
      });
      for (const message of parseEvolutionMessagePayload(payload)) {
        if (deltaSince && message.messageAt.getTime() < deltaSince.getTime()) continue;
        const sig = `${message.externalId}:${message.contactKey}`;
        if (!parsedMap.has(sig)) parsedMap.set(sig, message);
      }
    }
    const parsed = [...parsedMap.values()];
    if (!parsed.length) {
      if (this.inboxSyncStateReady()) {
        const pullAt = new Date();
        let emptyState = await this.inboxSyncState.findOne({ where: { instanceId } });
        if (!emptyState) {
          emptyState = this.inboxSyncState.create({ instanceId, lastIncrementalPullAt: pullAt });
        } else {
          emptyState.lastIncrementalPullAt = pullAt;
        }
        await this.inboxSyncState.save(emptyState).catch(() => {});
      }
      return;
    }

    const ownerUserId = await this.resolveOwnerUserId(instance);
    for (const message of parsed) {
      await this.ingestFromInstance(instance, { ownerUserId, parsed: message });
    }

    if (this.inboxSyncStateReady()) {
      const pullAt = new Date();
      let syncState = await this.inboxSyncState.findOne({ where: { instanceId } });
      if (!syncState) {
        syncState = this.inboxSyncState.create({ instanceId, lastIncrementalPullAt: pullAt });
      } else {
        syncState.lastIncrementalPullAt = pullAt;
      }
      await this.inboxSyncState.save(syncState).catch(() => {});
    }
    void this.bumpLocalMessageWatermark(
      instanceId,
      parsed.reduce(
        (max, row) => (row.messageAt > max ? row.messageAt : max),
        parsed[0]!.messageAt,
      ),
    );

    await this.rekeyThreadToPhoneIfKnown(
      instanceId,
      contactKey,
      parsed[parsed.length - 1]?.mediaPayload ?? null,
    );
    this.inboxRealtime.notifyThreadsUpdated(instanceId);
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
      const isArchived = group.some((row) => row.isArchived);
      merged.push({ ...best, contactPhone, threadKey, avatarUrl, unreadCount, isArchived });
    }

    return merged.sort(
      (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
    );
  }

  async resolveThreadContactKeys(instanceId: string, contactKey: string): Promise<string[]> {
    const keys = new Set<string>([contactKey]);

    if (contactKey.startsWith('group:')) {
      const suffix = contactKey.replace(/^group:/, '').replace(/\D/g, '');
      if (suffix.length >= 6) {
        const groupRows = await this.messages
          .createQueryBuilder('m')
          .select('DISTINCT m.contact_phone', 'contactPhone')
          .where('m.instance_id = :instanceId', { instanceId })
          .andWhere('m.contact_phone LIKE :pattern', { pattern: `group:%${suffix}` })
          .getRawMany<{ contactPhone: string }>();
        for (const row of groupRows) {
          const phone = String(row.contactPhone ?? '').trim();
          if (phone) keys.add(phone);
        }
      }
    }

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

    const remoteJid = await this.resolveRemoteJidForContact(instanceId, contactKey);
    if (remoteJid) {
      const jidRows = await this.messages
        .createQueryBuilder('m')
        .select('DISTINCT m.contact_phone', 'contactPhone')
        .where('m.instance_id = :instanceId', { instanceId })
        .andWhere('LOWER(m.remote_jid) = :remoteJid', { remoteJid: remoteJid.toLowerCase() })
        .getRawMany<{ contactPhone: string }>();
      for (const row of jidRows) {
        const phone = String(row.contactPhone ?? '').trim();
        if (phone) keys.add(phone);
      }
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
    const aliases = await this.resolveThreadContactKeys(instanceId, key);
    for (const alias of aliases) {
      const existing = await this.inboxReads.findOne({
        where: { userId, instanceId, contactKey: alias },
      });
      if (existing) {
        existing.lastReadAt = now;
        await this.inboxReads.save(existing);
      } else {
        await this.inboxReads.save(
          this.inboxReads.create({
            userId,
            instanceId,
            contactKey: alias,
            lastReadAt: now,
          }),
        );
      }
      await this.upsertDeviceReadAt(instanceId, alias, now);
    }
  }

  async applyChatsSyncFromWebhook(instanceId: string, data: unknown): Promise<number> {
    let updated = 0;
    const archiveTouched = new Set<string>();

    const applyArchive = async (contactKey: string, archived: boolean) => {
      const key = `${contactKey}:${archived}`;
      if (archiveTouched.has(key)) return;
      archiveTouched.add(key);
      if (await this.storeArchiveForThread(instanceId, contactKey, archived, true)) {
        updated += 1;
      }
    };

    for (const hint of extractArchiveHintsFromPayload(data)) {
      const resolved = resolveEvolutionContact({
        remoteJid: hint.remoteJid,
        remoteJidAlt: hint.remoteJid,
      });
      if (!resolved || resolved.contactKey === 'unknown') continue;
      await applyArchive(resolved.contactKey, hint.archived);
    }

    for (const chat of collectEvolutionChatRows(data)) {
      const jid = String(chat.id ?? chat.remoteJid ?? chat.jid ?? '').trim();
      if (!jid) continue;
      const resolved = resolveEvolutionContact({
        remoteJid: jid,
        remoteJidAlt: String(chat.remoteJidAlt ?? chat.remoteJid ?? ''),
      });
      if (!resolved || resolved.contactKey === 'unknown') continue;

      const archived = readChatArchived(chat);
      if (archived !== null) {
        await applyArchive(resolved.contactKey, archived);
      }

      const unread = readChatUnreadCount(chat);
      if (unread !== null && unread === 0) {
        const hinted = readChatReadTimestamp(chat);
        const readAt = await this.resolveDeviceReadAtForContact(
          instanceId,
          resolved.contactKey,
          hinted,
        );
        const readChanged = await this.upsertDeviceReadAt(instanceId, resolved.contactKey, readAt);
        if (readChanged) updated += 1;
      }
    }

    if (updated > 0) {
      this.inboxRealtime.notifyThreadsUpdated(instanceId);
    }
    return updated;
  }

  async syncDeviceReadStatesFromRemote(instanceId: string): Promise<number> {
    const id = String(instanceId ?? '').trim();
    if (!id) return 0;

    let chats: Awaited<ReturnType<typeof this.remoteChats.fetchChats>>;
    try {
      chats = await this.remoteChats.fetchChats(id);
    } catch {
      return 0;
    }

    let updated = 0;
    for (const chat of chats) {
      if (chat.unreadCount !== 0) continue;
      const readAt = await this.resolveDeviceReadAtForContact(id, chat.contactKey, null);
      const readChanged = await this.upsertDeviceReadAt(id, chat.contactKey, readAt);
      if (readChanged) updated += 1;
    }
    if (updated > 0) {
      this.inboxRealtime.notifyThreadsUpdated(id);
    }
    return updated;
  }

  private scheduleDeviceReadSync(instanceIds: string[]): void {
    const unique = [...new Set(instanceIds.map((value) => String(value ?? '').trim()).filter(Boolean))].slice(
      0,
      4,
    );
    for (const instanceId of unique) {
      const last = this.chatReadSyncAt.get(instanceId) ?? 0;
      if (Date.now() - last < INBOX_CHAT_READ_SYNC_MS) continue;
      this.chatReadSyncAt.set(instanceId, Date.now());
      void this.syncDeviceReadStatesFromRemote(instanceId).catch(() => 0);
    }
  }

  async syncChatArchiveFromRemote(instanceId: string): Promise<number> {
    const chats = await this.remoteChats.fetchChats(instanceId);
    let updated = 0;
    for (const chat of chats) {
      const archived =
        chat.archived ??
        readChatArchived(chat.raw) ??
        readChatArchived((chat.raw?.chat as Record<string, unknown>) ?? {});
      if (archived === null) continue;
      const changed = await this.storeArchiveForThread(instanceId, chat.contactKey, archived, true);
      if (changed) updated += 1;

      if (chat.unreadCount === 0) {
        const readAt = await this.resolveDeviceReadAtForContact(instanceId, chat.contactKey, null);
        const readChanged = await this.upsertDeviceReadAt(instanceId, chat.contactKey, readAt);
        if (readChanged) updated += 1;
      }
    }
    if (updated > 0) {
      this.inboxRealtime.notifyThreadsUpdated(instanceId);
    }
    return updated;
  }

  async setThreadArchived(input: {
    instanceId: string;
    contactKey: string;
    archive: boolean;
    syncWhatsApp?: boolean;
  }): Promise<{ isArchived: boolean; syncedWhatsApp: boolean; warning?: string }> {
    const instanceId = String(input.instanceId ?? '').trim();
    const contactKey = String(input.contactKey ?? '').trim();
    const archive = Boolean(input.archive);
    if (!instanceId || !contactKey) {
      throw new NotFoundException('Conversa não encontrada.');
    }

    const fromPanel = input.syncWhatsApp === false;
    await this.storeArchiveForThread(instanceId, contactKey, archive, fromPanel);

    let syncedWhatsApp = false;
    let syncWarning: string | undefined;
    if (input.syncWhatsApp !== false) {
      const remoteJid = await this.resolveRemoteJidForContact(instanceId, contactKey);
      if (remoteJid) {
        const lastMessage = await this.buildLastMessagePayloadForArchive(instanceId, contactKey);
        if (!lastMessage) {
          syncWarning =
            'Conversa arquivada no painel; WhatsApp não sincronizado (sem última mensagem no servidor).';
        } else {
          const outcome = await this.remoteChats.archiveChat(instanceId, {
            remoteJid,
            archive,
            lastMessage,
          });
          syncedWhatsApp = outcome.ok;
          if (!outcome.ok && outcome.error) {
            syncWarning = `Conversa arquivada no painel; WhatsApp: ${outcome.error.slice(0, 180)}`;
          }
        }
      } else {
        syncWarning = 'Conversa arquivada no painel; JID do chat não encontrado para o WhatsApp.';
      }
    }

    this.inboxRealtime.notifyThreadsUpdated(instanceId);
    return { isArchived: archive, syncedWhatsApp, warning: syncWarning };
  }

  /** Grava o estado de arquivo em todas as chaves da thread (telefone, LID, grupo). */
  private async storeArchiveForThread(
    instanceId: string,
    contactKey: string,
    archived: boolean,
    fromDevice: boolean,
  ): Promise<boolean> {
    const keys = await this.resolveThreadContactKeys(instanceId, contactKey);
    let changed = false;
    for (const key of keys) {
      if (await this.upsertThreadArchive(instanceId, key, archived, fromDevice)) {
        changed = true;
      }
    }
    return changed;
  }

  private async upsertThreadArchive(
    instanceId: string,
    contactKey: string,
    archived: boolean,
    fromDevice: boolean,
  ): Promise<boolean> {
    const key = String(contactKey ?? '').trim();
    if (!key) return false;
    const existing = await this.threadArchives.findOne({ where: { instanceId, contactKey: key } });
    const archivedAt = archived ? new Date() : null;
    if (existing) {
      if (existing.isArchived === archived) return false;
      existing.isArchived = archived;
      existing.archivedAt = archivedAt;
      existing.syncedFromDevice = fromDevice;
      await this.threadArchives.save(existing);
      return true;
    }
    if (!archived) return false;
    await this.threadArchives.save(
      this.threadArchives.create({
        instanceId,
        contactKey: key,
        isArchived: true,
        archivedAt,
        syncedFromDevice: fromDevice,
      }),
    );
    return true;
  }

  private async resolveRemoteJidForContact(
    instanceId: string,
    contactKey: string,
  ): Promise<string | null> {
    const profile = await this.contactProfiles.findOne({
      where: { instanceId, contactKey },
      select: ['remoteJid'],
    });
    if (profile?.remoteJid?.trim()) return profile.remoteJid.trim();

    const latest = await this.messages.findOne({
      where: { instanceId, contactPhone: contactKey },
      order: { messageAt: 'DESC' },
      select: ['remoteJid'],
    });
    if (latest?.remoteJid?.trim()) return latest.remoteJid.trim();

    if (contactKey.startsWith('group:')) {
      return `${contactKey.replace(/^group:/, '')}@g.us`;
    }
    const digits = contactKey.replace(/\D/g, '');
    if (digits.length >= 10) return `${digits}@s.whatsapp.net`;
    if (contactKey.startsWith('lid:')) {
      const lid = contactKey.slice(4);
      if (lid) return `${lid}@lid`;
    }
    return null;
  }

  private async buildLastMessagePayloadForArchive(
    instanceId: string,
    contactKey: string,
  ): Promise<Record<string, unknown> | null> {
    const keys = await this.resolveThreadContactKeys(instanceId, contactKey);
    const row = await this.messages.findOne({
      where: { instanceId, contactPhone: In(keys) },
      order: { messageAt: 'DESC' },
      select: ['externalId', 'direction', 'remoteJid', 'mediaPayload', 'messageAt'],
    });
    if (!row) return null;

    const messageTimestamp = Math.floor(row.messageAt.getTime() / 1000);

    if (row.mediaPayload?.trim()) {
      try {
        const payload = JSON.parse(row.mediaPayload) as Record<string, unknown>;
        const key = (payload.key ?? {}) as Record<string, unknown>;
        if (key.id && key.remoteJid) {
          const messageBlock = payload.message;
          const nestedTs =
            messageBlock && typeof messageBlock === 'object'
              ? (messageBlock as Record<string, unknown>).messageTimestamp
              : undefined;
          const rawTs = payload.messageTimestamp ?? nestedTs;
          const ts =
            typeof rawTs === 'number' && Number.isFinite(rawTs)
              ? Math.floor(rawTs > 1e12 ? rawTs / 1000 : rawTs)
              : messageTimestamp;
          return {
            key: {
              remoteJid: key.remoteJid,
              fromMe: Boolean(key.fromMe),
              id: String(key.id),
            },
            messageTimestamp: ts,
          };
        }
      } catch {
        /* fallback */
      }
    }

    const remoteJid = row.remoteJid ?? (await this.resolveRemoteJidForContact(instanceId, contactKey));
    if (!remoteJid || !row.externalId) return null;
    return {
      key: {
        remoteJid,
        fromMe: row.direction === 'out',
        id: row.externalId,
      },
      messageTimestamp,
    };
  }

  private async isContactArchived(instanceId: string, contactKey: string): Promise<boolean> {
    const keys = await this.resolveThreadContactKeys(instanceId, contactKey);
    const rows = await this.threadArchives.find({
      where: { instanceId, contactKey: In(keys), isArchived: true },
      select: ['id'],
      take: 1,
    });
    return rows.length > 0;
  }

  private async upsertDeviceReadAt(
    instanceId: string,
    contactKey: string,
    readAt: Date,
  ): Promise<boolean> {
    const key = String(contactKey ?? '').trim();
    if (!key) return false;
    const existing = await this.deviceReads.findOne({ where: { instanceId, contactKey: key } });
    if (existing) {
      if (existing.readAt.getTime() >= readAt.getTime()) return false;
      existing.readAt = readAt;
      await this.deviceReads.save(existing);
      return true;
    }
    await this.deviceReads.save(
      this.deviceReads.create({
        instanceId,
        contactKey: key,
        readAt,
      }),
    );
    return true;
  }

  private async resolveDeviceReadAtForContact(
    instanceId: string,
    contactKey: string,
    hinted: Date | null,
  ): Promise<Date> {
    const latestInbound = await this.messages.findOne({
      where: { instanceId, contactPhone: contactKey, direction: 'in' },
      order: { messageAt: 'DESC' },
      select: ['messageAt'],
    });
    const candidates = [hinted, latestInbound?.messageAt, new Date()].filter(Boolean) as Date[];
    return new Date(Math.max(...candidates.map((value) => value.getTime())));
  }

  private async effectiveReadSince(
    userId: string,
    instanceId: string,
    contactKey: string,
  ): Promise<Date | null> {
    const keys = await this.resolveThreadContactKeys(instanceId, contactKey);
    const userReads = await this.inboxReads.find({
      where: { userId, instanceId, contactKey: In(keys) },
      select: ['lastReadAt'],
    });
    const deviceReads = await this.deviceReads.find({
      where: { instanceId, contactKey: In(keys) },
      select: ['readAt'],
    });
    const stamps = [
      ...userReads.map((row) => row.lastReadAt),
      ...deviceReads.map((row) => row.readAt),
    ].filter(Boolean) as Date[];
    if (!stamps.length) return null;
    return new Date(Math.max(...stamps.map((value) => value.getTime())));
  }

  private async countUnreadMessages(
    userId: string,
    instanceId: string,
    contactKey: string,
  ): Promise<number> {
    const keys = await this.resolveThreadContactKeys(instanceId, contactKey);
    const since = await this.effectiveReadSince(userId, instanceId, contactKey);
    return this.countUnreadWithSince(instanceId, keys, since);
  }

  private async countUnreadWithSince(
    instanceId: string,
    contactKeys: string[],
    since: Date | null,
  ): Promise<number> {
    const keys = [...new Set(contactKeys.map((key) => String(key ?? '').trim()).filter(Boolean))];
    if (!keys.length) return 0;

    const qb = this.messages
      .createQueryBuilder('m')
      .where('m.instance_id = :instanceId', { instanceId })
      .andWhere('m.contact_phone IN (:...keys)', { keys })
      .andWhere("m.direction = 'in'")
      .andWhere("(m.media_kind IS NULL OR m.media_kind <> 'reaction')");

    if (since) {
      qb.andWhere('m.message_at > :since', { since });
    }

    return qb.getCount();
  }

  private async buildReadStampIndex(
    userId: string,
    instanceIds: string[],
  ): Promise<Map<string, Date>> {
    const uniqueIds = [...new Set(instanceIds.map((id) => String(id ?? '').trim()).filter(Boolean))];
    if (!userId || !uniqueIds.length) return new Map();

    const [userReads, deviceReads] = await Promise.all([
      this.inboxReads.find({
        where: { userId, instanceId: In(uniqueIds) },
        select: ['instanceId', 'contactKey', 'lastReadAt'],
      }),
      this.deviceReads.find({
        where: { instanceId: In(uniqueIds) },
        select: ['instanceId', 'contactKey', 'readAt'],
      }),
    ]);

    const index = new Map<string, Date>();
    const upsert = (instanceId: string, contactKey: string, at: Date) => {
      const key = `${instanceId}:${String(contactKey ?? '').trim()}`;
      const prev = index.get(key);
      if (!prev || at > prev) index.set(key, at);
    };
    for (const row of userReads) {
      if (row.lastReadAt) upsert(row.instanceId, row.contactKey, row.lastReadAt);
    }
    for (const row of deviceReads) {
      if (row.readAt) upsert(row.instanceId, row.contactKey, row.readAt);
    }
    return index;
  }

  private readSinceFromIndex(
    index: Map<string, Date>,
    instanceId: string,
    contactKeys: string[],
  ): Date | null {
    let max: Date | null = null;
    for (const contactKey of contactKeys) {
      const stamp = index.get(`${instanceId}:${String(contactKey ?? '').trim()}`);
      if (stamp && (!max || stamp > max)) max = stamp;
    }
    return max;
  }

  private async loadArchivedKeysSet(instanceIds: string[]): Promise<Set<string>> {
    const uniqueIds = [...new Set(instanceIds.map((id) => String(id ?? '').trim()).filter(Boolean))];
    if (!uniqueIds.length) return new Set();
    const rows = await this.threadArchives.find({
      where: { instanceId: In(uniqueIds), isArchived: true },
      select: ['instanceId', 'contactKey'],
    });
    return new Set(
      rows.map((row) => `${row.instanceId}:${String(row.contactKey ?? '').trim()}`).filter(Boolean),
    );
  }

  private threadIsArchived(
    archivedSet: Set<string>,
    instanceId: string,
    contactKeys: string[],
  ): boolean {
    return contactKeys.some((key) => archivedSet.has(`${instanceId}:${String(key ?? '').trim()}`));
  }

  /** Nomes, avatares, LID e arquivados — disparado em background ao listar conversas (throttle ~5 min). */
  queueBackgroundMaintenance(instanceIds: string[]): void {
    const unique = [...new Set(instanceIds.map((id) => String(id ?? '').trim()).filter(Boolean))];
    for (const id of unique) {
      const last = this.backgroundMaintenanceAt.get(id) ?? 0;
      if (Date.now() - last < 8 * 60_000) continue;
      this.backgroundMaintenanceAt.set(id, Date.now());
      void this.runBackgroundMaintenance(id).catch(() => {});
    }
  }

  private async runBackgroundMaintenance(instanceId: string): Promise<void> {
    const lid = await this.backfillLidThreadsFromStoredPayloads(instanceId, 120);
    const archives = await this.syncChatArchiveFromRemote(instanceId).catch(() => 0);
    const names = await this.syncContactNamesFromEvolution(instanceId).catch(() => ({
      updated: 0,
      avatars: 0,
      avatarsStored: 0,
    }));
    const changed = lid > 0 || archives > 0 || (names.updated ?? 0) > 0 || (names.avatarsStored ?? 0) > 0;
    if (changed) {
      this.inboxRealtime.notifyThreadsUpdated(instanceId);
    }
  }

  async listInstancesWithMessageHistory(): Promise<EvolutionInboxInstanceOptionDto[]> {
    const rows = await this.messages
      .createQueryBuilder('m')
      .innerJoin('m.instance', 'inst')
      .select('inst.id', 'id')
      .addSelect('inst.name', 'name')
      .where('inst.active = :active', { active: true })
      .andWhere("m.contact_phone IS NOT NULL AND TRIM(m.contact_phone) <> ''")
      .andWhere("m.contact_phone NOT IN ('unknown', '-')")
      .andWhere("(m.media_kind IS NULL OR m.media_kind <> 'reaction')")
      .groupBy('inst.id')
      .addGroupBy('inst.name')
      .orderBy('inst.name', 'ASC')
      .getRawMany<{ id: string; name: string }>();

    return rows
      .map((row) => ({
        id: String(row.id ?? '').trim(),
        name: String(row.name ?? '').trim() || 'WhatsApp',
      }))
      .filter((row) => row.id);
  }

  async listThreads(
    userId: string,
    filters?: {
      instanceId?: string;
      view?: 'active' | 'archived' | 'all';
      light?: boolean;
      limit?: number;
      offset?: number;
    },
  ): Promise<EvolutionInboxThreadsPageDto> {
    const instanceId = filters?.instanceId?.trim();
    const view = filters?.view ?? 'active';
    const light = Boolean(filters?.light);
    const pageLimit = Math.min(
      INBOX_THREADS_PAGE_MAX,
      Math.max(1, filters?.limit ?? INBOX_THREADS_PAGE_DEFAULT),
    );
    const pageOffset = Math.max(0, filters?.offset ?? 0);
    const fetchLimit = pageLimit + 1;
    let remoteGroupTitles = new Map<string, string>();
    if (instanceId && !light) {
      const archiveSyncAt = this.chatArchiveSyncAt.get(instanceId) ?? 0;
      const archiveSyncDue = Date.now() - archiveSyncAt > 3 * 60_000;
      const needsArchiveSync = view === 'archived' || view === 'all';
      if (archiveSyncDue && (needsArchiveSync || view === 'active')) {
        this.chatArchiveSyncAt.set(instanceId, Date.now());
        const sync = this.syncChatArchiveFromRemote(instanceId).catch(() => 0);
        if (needsArchiveSync) {
          await sync;
        } else {
          void sync;
        }
      }
      const last = this.groupTitleRefreshAt.get(instanceId) ?? 0;
      const ttlMs = 2 * 60_000;
      if (Date.now() - last > ttlMs) {
        this.groupTitleRefreshAt.set(instanceId, Date.now());
        void this.backfillGroupThreadNames(instanceId)
          .then(() => this.backfillMessageBodiesFromPayload(instanceId, 800))
          .then(() => this.refreshRemoteGroupTitleCache(instanceId))
          .catch(() => {});
      }
      remoteGroupTitles = await this.remoteGroupTitlesForInstance(instanceId);
      this.queueBackgroundMaintenance([instanceId]);
    }

    const latestSub = this.messages
      .createQueryBuilder('lm')
      .select('lm.instance_id', 'instanceId')
      .addSelect('lm.contact_phone', 'contactPhone')
      .addSelect('MAX(lm.message_at)', 'maxAt')
      .where("lm.contact_phone IS NOT NULL AND TRIM(lm.contact_phone) <> ''")
      .andWhere("lm.contact_phone NOT IN ('unknown', '-')")
      .andWhere("(lm.media_kind IS NULL OR lm.media_kind <> 'reaction')")
      .groupBy('lm.instance_id')
      .addGroupBy('lm.contact_phone');

    if (filters?.instanceId) {
      latestSub.andWhere('lm.instance_id = :instanceId', { instanceId: filters.instanceId });
    }

    latestSub.orderBy('maxAt', 'DESC').offset(pageOffset).limit(fetchLimit);

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

    const rawMessageRows = await qb.getMany();
    const hasMore = rawMessageRows.length >= fetchLimit;
    const rows = this.collapseMessageRowsByRemoteJid(rawMessageRows);
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
    if (instanceIds.length) {
      this.scheduleDeviceReadSync(instanceId ? [instanceId] : instanceIds);
    }
    if (!light && !instanceId && instanceIds.length) {
      this.queueBackgroundMaintenance(instanceIds);
    }
    const profileRows = instanceIds.length
      ? await this.contactProfiles.find({ where: { instanceId: In(instanceIds) } })
      : [];
    const localGroupTitles = new Map<string, string>();
    for (const profile of profileRows) {
      if (!isGroupContactKey(profile.contactKey)) continue;
      const title = this.pickAuthoritativeGroupTitle(profile.displayName, profile.contactKey);
      if (title) localGroupTitles.set(`${profile.instanceId}:${profile.contactKey}`, title);
    }

    for (const id of instanceIds) {
      const cached = this.remoteGroupTitleCache.get(id);
      if (cached?.titles) {
        for (const [groupKey, title] of cached.titles) {
          if (!remoteGroupTitles.has(groupKey)) remoteGroupTitles.set(groupKey, title);
        }
      }
    }
    this.scheduleGroupTitleRefreshForInstances(instanceIds, light);

    const threadNameHints = await this.loadBestContactNamesForThreads(rows);

    const groupPayloadJobs: Array<{ instanceId: string; contactKey: string }> = [];
    for (const latest of rows) {
      const contactPhone = String(latest.contactPhone ?? '').trim();
      if (!isGroupContactKey(contactPhone)) continue;
      const composite = `${latest.instanceId}:${contactPhone}`;
      const profile = this.findContactProfileForDisplay(
        latest.instanceId,
        contactPhone,
        profileRows,
        latest.leadId,
      );
      const hasTitle = Boolean(
        localGroupTitles.get(composite) ??
          remoteGroupTitles.get(contactPhone) ??
          this.pickAuthoritativeGroupTitle(profile?.displayName, contactPhone),
      );
      if (!hasTitle) {
        groupPayloadJobs.push({ instanceId: latest.instanceId, contactKey: contactPhone });
      }
    }
    const payloadGroupTitles = await this.loadGroupTitlesFromStoredPayloads(groupPayloadJobs);

    const readIndex = userId ? await this.buildReadStampIndex(userId, instanceIds) : new Map<string, Date>();
    const archivedSet = await this.loadArchivedKeysSet(instanceIds);

    const contactKeysByRow = await Promise.all(
      rows.map(async (latest) => {
        const contactPhone = String(latest.contactPhone ?? '').trim();
        if (!contactPhone || contactPhone === 'unknown') return [];
        return light
          ? [contactPhone]
          : await this.resolveThreadContactKeys(latest.instanceId, contactPhone);
      }),
    );

    const unreadCounts = await Promise.all(
      rows.map(async (latest, rowIndex) => {
        const contactPhone = String(latest.contactPhone ?? '').trim();
        if (!userId || !contactPhone || contactPhone === 'unknown') return 0;
        const contactKeys = contactKeysByRow[rowIndex] ?? [];
        const since = this.readSinceFromIndex(readIndex, latest.instanceId, contactKeys);
        return this.countUnreadWithSince(latest.instanceId, contactKeys, since);
      }),
    );

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const latest = rows[rowIndex]!;
      const contactPhone = String(latest.contactPhone ?? '').trim();
      if (!contactPhone || contactPhone === 'unknown') continue;

      const contactKeys = contactKeysByRow[rowIndex] ?? [contactPhone];

      const threadKey = `${latest.instanceId}:${contactPhone}`;
      const lead = latest.leadId ? leadById.get(latest.leadId) ?? null : null;
      const leadTitle = lead?.title ?? null;
      const profile = this.findContactProfileForDisplay(
        latest.instanceId,
        contactPhone,
        profileRows,
        latest.leadId,
      );
      const avatarProfile = this.findContactProfileForAvatar(
        latest.instanceId,
        contactPhone,
        profileRows,
        latest.leadId,
      );
      const threadHintKey = `${latest.instanceId}:${contactPhone}`;
      const profileGroupTitle = isGroupContactKey(contactPhone)
        ? this.pickAuthoritativeGroupTitle(profile?.displayName, contactPhone)
        : null;
      const remoteGroupTitle = isGroupContactKey(contactPhone)
        ? localGroupTitles.get(threadHintKey) ??
          payloadGroupTitles.get(threadHintKey) ??
          remoteGroupTitles.get(contactPhone) ??
          null
        : null;
      const messageNames = isGroupContactKey(contactPhone)
        ? [remoteGroupTitle, profileGroupTitle, profile?.displayName, threadNameHints.get(threadHintKey)]
        : [
            threadNameHints.get(threadHintKey),
            latest.contactName,
            latest.senderName,
            profile?.displayName,
            lead?.contactName,
            lead?.title,
          ];
      const contactPhoneLabel = profile?.phoneLabel ?? formatPhoneLenient(contactPhone);
      const contactDisplayName = pickBestThreadContactName(
        messageNames,
        lead,
        contactPhone,
        contactPhoneLabel,
      );
      const isGroup = isGroupContactKey(contactPhone);
      const presentation = resolveInboxContactPresentation({
        contactKey: contactPhone,
        displayName: contactDisplayName,
        phoneLabel: isGroup ? null : contactPhoneLabel,
        instanceName: latest.instance?.name ?? 'WhatsApp',
        leadTitle,
        leadContactName: lead?.contactName ?? null,
        leadPhone: lead?.phone ?? null,
      });
      const contactSubtitle = isGroup
        ? presentation.subtitle
        : presentation.subtitle ??
          this.buildThreadSubtitle(
            latest.instance?.name ?? 'WhatsApp',
            contactPhoneLabel,
            contactDisplayName,
          );
      const avatarStored = Boolean(avatarProfile?.avatarStoragePath);
      const proxyPath = avatarStored
        ? `/api/admin/evolution/inbox/threads/${latest.instanceId}/${encodeURIComponent(contactPhone)}/avatar`
        : null;
      const avatarUrl = avatarStored
        ? proxyPath
        : avatarProfile?.avatarUrl?.startsWith('http')
          ? avatarProfile.avatarUrl
          : null;

      draftThreads.push({
        threadKey,
        instanceId: latest.instanceId,
        instanceName: latest.instance?.name ?? 'WhatsApp',
        contactPhone,
        contactName: isHumanContactName(latest.contactName) ? latest.contactName : null,
        contactDisplayName: presentation.title,
        contactSubtitle,
        contactPhoneLabel: isGroup ? null : presentation.phoneLine ?? contactPhoneLabel,
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
        unreadCount: unreadCounts[rowIndex] ?? 0,
        isArchived: this.threadIsArchived(archivedSet, latest.instanceId, contactKeys),
      });
    }

    const merged = this.mergeInboxThreads(draftThreads);
    let threads = merged;

    if (view === 'archived') {
      threads = threads.filter((thread) => thread.isArchived);
    } else if (view === 'active') {
      threads = threads.filter((thread) => !thread.isArchived);
    }

    return {
      threads,
      hasMore,
      limit: pageLimit,
      offset: pageOffset,
    };
  }

  private async queryThreadMessageRows(
    instanceId: string,
    contactKeys: string[],
    limit: number,
  ): Promise<EvolutionMessage[]> {
    const keys = [...new Set(contactKeys.map((key) => String(key ?? '').trim()).filter(Boolean))];
    if (!keys.length) return [];
    return this.messages.find({
      where: { instanceId, contactPhone: In(keys) },
      order: { messageAt: 'DESC' },
      take: limit,
    });
  }

  async listThreadMessages(
    userId: string | null,
    instanceId: string,
    contactPhone: string,
    limit = 300,
    options?: { syncRemote?: boolean | 'auto' },
  ): Promise<EvolutionInboxMessageDto[]> {
    const contactKey = String(contactPhone ?? '').trim();
    if (!contactKey) throw new NotFoundException('Conversa não encontrada.');

    const instance = await this.instances.findOne({ where: { id: instanceId }, select: ['id'] });
    if (!instance) throw new NotFoundException('Instância não encontrada.');

    const syncMode = options?.syncRemote ?? 'auto';
    const contactKeys = await this.resolveThreadContactKeys(instanceId, contactKey);
    const localMax = await this.latestMessageAtForContactKeys(instanceId, contactKeys);

    const markReadPromise = userId ? this.markThreadRead(userId, instanceId, contactKey) : Promise.resolve();

    let pullBlocking = false;
    let pullBackground = false;
    if (syncMode === true) {
      pullBlocking = true;
    } else if (syncMode === 'auto') {
      pullBlocking = !localMax;
      if (localMax) {
        const webhookHealthy = await this.isInstanceWebhookHealthy(instanceId);
        pullBackground = !webhookHealthy;
      }
    }

    if (pullBlocking) {
      try {
        await this.pullRemoteMessagesForThreadIfDue(instanceId, contactKey, {
          force: syncMode === true,
        });
      } catch {
        /* Evolution indisponível: exibe histórico local */
      }
    } else if (pullBackground) {
      void this.pullRemoteMessagesForThreadIfDue(instanceId, contactKey).catch(() => {});
    }

    const skipRepair = syncMode === false;
    const take = Math.max(1, Math.min(limit, 500));

    const [, initialRows] = await Promise.all([
      markReadPromise,
      this.queryThreadMessageRows(instanceId, contactKeys, take),
    ]);

    let rows = initialRows;
    if (!skipRepair) {
      await this.repairReactionMessages(instanceId, Math.max(take, 400), contactKeys);
      rows = await this.queryThreadMessageRows(instanceId, contactKeys, take);
    }

    const chronological = [...rows].reverse();
    return this.buildThreadMessageList(chronological);
  }

  async applyPushNamesFromPayload(instanceId: string, data: unknown): Promise<number> {
    const parsed = parseEvolutionMessagePayload(data);
    const bestNameByKey = new Map<string, string>();
    const jidByKey = new Map<string, string>();

    for (const message of parsed) {
      if (message.isGroup) {
        const subject =
          evolutionGroupSubjectTitle(message.groupName) ??
          (message.groupName?.trim() && isPlausibleGroupTitle(message.groupName)
            ? message.groupName.trim()
            : null);
        if (subject) {
          const prev = bestNameByKey.get(message.contactKey);
          if (!prev || subject.length > prev.length) {
            bestNameByKey.set(message.contactKey, subject);
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

  private findContactProfileForDisplay(
    instanceId: string,
    contactKey: string,
    profileRows: EvolutionContactProfile[],
    leadId?: string | null,
  ): EvolutionContactProfile | null {
    const forInstance = profileRows.filter((row) => row.instanceId === instanceId);
    const hasGoodName = (row: EvolutionContactProfile) => {
      const name = String(row.displayName ?? '').trim();
      return Boolean(name) && !isGenericInboxLabel(name) && !isGenericGroupThreadName(name, row.contactKey);
    };

    const exactNamed = forInstance.find((row) => row.contactKey === contactKey && hasGoodName(row));
    if (exactNamed) return exactNamed;

    const resolvedNamed = this.resolveContactProfile(forInstance, instanceId, contactKey);
    if (resolvedNamed && hasGoodName(resolvedNamed)) return resolvedNamed;

    if (leadId) {
      const byLead = forInstance.find((row) => row.leadId === leadId && hasGoodName(row));
      if (byLead) return byLead;
    }

    return (
      forInstance.find((row) => row.contactKey === contactKey) ??
      resolvedNamed ??
      (leadId ? forInstance.find((row) => row.leadId === leadId) ?? null : null)
    );
  }

  private async loadBestContactNamesForThreads(
    rows: EvolutionMessage[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!rows.length) return map;

    const instanceIds = [...new Set(rows.map((row) => row.instanceId))];
    const contactPhones = [...new Set(rows.map((row) => String(row.contactPhone ?? '').trim()).filter(Boolean))];
    if (!contactPhones.length) return map;

    const nameRows = await this.messages
      .createQueryBuilder('m')
      .select('m.instance_id', 'instanceId')
      .addSelect('m.contact_phone', 'contactPhone')
      .addSelect('m.contact_name', 'contactName')
      .addSelect('m.sender_name', 'senderName')
      .where('m.instance_id IN (:...instanceIds)', { instanceIds })
      .andWhere('m.contact_phone IN (:...contactPhones)', { contactPhones })
      .andWhere("(TRIM(COALESCE(m.contact_name, '')) <> '' OR TRIM(COALESCE(m.sender_name, '')) <> '')")
      .orderBy('m.message_at', 'DESC')
      .getRawMany<{
        instanceId: string;
        contactPhone: string;
        contactName: string | null;
        senderName: string | null;
      }>();

    for (const row of nameRows) {
      const key = `${row.instanceId}:${String(row.contactPhone ?? '').trim()}`;
      if (map.has(key)) continue;
      for (const raw of [row.contactName, row.senderName]) {
        const value = String(raw ?? '').trim();
        if (!isHumanContactName(value) || isGenericInboxLabel(value)) continue;
        if (isGroupContactKey(row.contactPhone) && isLikelyParticipantName(value)) continue;
        map.set(key, value);
        break;
      }
    }

    return map;
  }

  private async loadGroupTitlesFromStoredPayloads(
    items: Array<{ instanceId: string; contactKey: string }>,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const unique: Array<{ instanceId: string; contactKey: string }> = [];
    const seen = new Set<string>();
    for (const item of items) {
      const key = `${item.instanceId}:${item.contactKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }

    const chunkSize = 8;
    for (let offset = 0; offset < unique.length; offset += chunkSize) {
      const chunk = unique.slice(offset, offset + chunkSize);
      await Promise.all(
        chunk.map(async ({ instanceId, contactKey }) => {
          const title = await this.bestGroupTitleFromStoredPayloads(instanceId, contactKey);
          if (title) out.set(`${instanceId}:${contactKey}`, title);
        }),
      );
    }
    return out;
  }

  private scheduleGroupTitleRefreshForInstances(instanceIds: string[], light: boolean): void {
    const ttlMs = light ? 12 * 60_000 : 2 * 60_000;
    for (const id of instanceIds) {
      const last = this.groupTitleRefreshAt.get(id) ?? 0;
      if (Date.now() - last < ttlMs) continue;
      this.groupTitleRefreshAt.set(id, Date.now());
      void this.backfillGroupThreadNames(id)
        .then(() => this.refreshRemoteGroupTitleCache(id))
        .catch(() => {});
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

  async backfillLidThreadsFromStoredPayloads(instanceId: string, limit = 400): Promise<number> {
    const rows = await this.messages
      .createQueryBuilder('m')
      .where('m.instance_id = :instanceId', { instanceId })
      .andWhere("m.contact_phone LIKE 'lid:%'")
      .andWhere('m.media_payload IS NOT NULL AND TRIM(m.media_payload) <> \'\'')
      .orderBy('m.message_at', 'DESC')
      .take(limit)
      .getMany();
    const touched = new Set<string>();
    let updated = 0;
    for (const row of rows) {
      const lidKey = String(row.contactPhone ?? '').trim();
      if (!lidKey || touched.has(lidKey)) continue;
      touched.add(lidKey);
      const phoneKey = await this.rekeyThreadToPhoneIfKnown(instanceId, lidKey, row.mediaPayload);
      if (phoneKey) updated += 1;
    }
    return updated;
  }

  /** Após conectar o WhatsApp: identidades primeiro, depois prévia leve das conversas. */
  queueInboxBootstrapAfterConnect(instanceId: string, options?: { force?: boolean }): void {
    const key = String(instanceId ?? '').trim();
    if (!key) return;
    const force = Boolean(options?.force);
    const last = this.connectBootstrapAt.get(key) ?? 0;
    if (!force && Date.now() - last < 20 * 60_000) return;
    if (this.connectBootstrapInFlight.has(key)) return;

    this.connectBootstrapInFlight.add(key);
    this.connectBootstrapAt.set(key, Date.now());
    void this.runInboxBootstrapAfterConnect(key)
      .catch(() => {})
      .finally(() => this.connectBootstrapInFlight.delete(key));
  }

  private chatRecencyFromRaw(raw: Record<string, unknown>): number {
    const conv = Number(raw.conversationTimestamp ?? raw.t ?? 0);
    if (Number.isFinite(conv) && conv > 0) return conv;
    const last = raw.lastMessage as Record<string, unknown> | undefined;
    const nested = last?.messageTimestamp ?? last?.timestamp ?? (last?.key as Record<string, unknown> | undefined)?.messageTimestamp;
    const ts = Number(nested ?? 0);
    return Number.isFinite(ts) ? ts : 0;
  }

  private async seedProfilesFromRemoteChats(
    instanceId: string,
    chats: EvolutionRemoteChatRow[],
  ): Promise<void> {
    const seen = new Set<string>();
    for (const chat of chats) {
      const entry = this.remoteContacts.profileFromEvolutionRecord(chat.raw);
      if (!entry) continue;
      const contactKey = String(entry.contactKey ?? '').trim();
      if (!contactKey || contactKey === 'unknown' || seen.has(contactKey)) continue;
      seen.add(contactKey);
      await this.upsertContactProfile({
        instanceId,
        contactKey,
        displayName: entry.displayName,
        phoneLabel: entry.phoneLabel,
        remoteJid: entry.remoteJid ?? chat.remoteJid,
        avatarUrl: entry.avatarUrl,
      });
      if (entry.avatarUrl?.startsWith('http')) {
        await this.contactAvatars
          .persistProfileAvatar(instanceId, contactKey, entry.avatarUrl)
          .catch(() => {});
      }
    }
  }

  private isWeakGroupSenderLabel(sender: string | null | undefined): boolean {
    const value = String(sender ?? '').trim();
    if (!value) return true;
    if (/^\d{3,6}$/.test(value)) return true;
    if (/^whatsapp\s*···/i.test(value)) return true;
    return false;
  }

  private async runInboxBootstrapAfterConnect(instanceId: string): Promise<void> {
    const instance = await this.instances.findOne({
      where: { id: instanceId, active: true },
      select: ['id', 'name', 'defaultOwnerUserId', 'autoCreateLeads'],
    });
    if (!instance) return;

    const chats = await this.remoteChats.fetchChats(instanceId);
    const sorted = [...chats].sort(
      (a, b) => this.chatRecencyFromRaw(b.raw) - this.chatRecencyFromRaw(a.raw),
    );
    const targets = sorted.slice(0, INBOX_BOOTSTRAP_CHAT_LIMIT);

    await this.seedProfilesFromRemoteChats(instanceId, sorted);
    const lidAliases = await this.remoteContacts.fetchLidPhoneAliases(instanceId);
    await this.reconcileLidContactPhones(instanceId, lidAliases);
    await this.refreshRemoteGroupTitleCache(instanceId).catch(() => {});
    await this.syncContactNamesFromEvolution(instanceId, { bootstrap: true });
    this.inboxRealtime.notifyThreadsUpdated(instanceId);

    void this.syncChatArchiveFromRemote(instanceId).catch(() => 0);

    if (!targets.length) return;

    const ownerUserId = await this.resolveOwnerUserId(instance);

    const ingestChat = async (chat: EvolutionRemoteChatRow) => {
      const jid = String(chat.remoteJid ?? '').trim();
      if (!jid) return;
      const payload = await this.remoteMessages.fetchMessagesForJid(
        instanceId,
        jid,
        INBOX_BOOTSTRAP_MESSAGES_PER_CHAT,
      );
      for (const parsed of parseEvolutionMessagePayload(payload)) {
        await this.ingestFromInstance(instance, { ownerUserId, parsed });
      }
    };

    for (let offset = 0; offset < targets.length; offset += INBOX_BOOTSTRAP_CHAT_CONCURRENCY) {
      const slice = targets.slice(offset, offset + INBOX_BOOTSTRAP_CHAT_CONCURRENCY);
      await Promise.all(slice.map((chat) => ingestChat(chat)));
    }

    await this.backfillLidThreadsFromStoredPayloads(instanceId, 120);
    await this.backfillNamesFromStoredMessages(instanceId);
    await this.backfillGroupThreadNames(instanceId).catch(() => 0);
    await this.refreshRemoteGroupTitleCache(instanceId).catch(() => {});
    await this.syncContactNamesFromEvolution(instanceId, { bootstrap: true, postIngest: true });
    this.inboxRealtime.notifyThreadsUpdated(instanceId);
  }

  async syncContactNamesFromEvolution(
    instanceId: string,
    options?: { bootstrap?: boolean; postIngest?: boolean },
  ): Promise<{ updated: number; avatars: number; avatarsStored: number }> {
    const bootstrap = Boolean(options?.bootstrap);
    const postIngest = Boolean(options?.postIngest);
    if (!postIngest) {
      await this.backfillLidThreadsFromStoredPayloads(instanceId, bootstrap ? 80 : 400);
    }
    if (!bootstrap && !postIngest) {
      await this.ensureThreadProfilesFromMessages(instanceId);
    }
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

    const avatarLimit = bootstrap ? INBOX_BOOTSTRAP_AVATAR_LIMIT : 400;
    if (bootstrap && profiles.length > avatarLimit) {
      const chats = await this.remoteChats.fetchChats(instanceId);
      const priorityKeys = new Set(
        [...chats]
          .sort((a, b) => this.chatRecencyFromRaw(b.raw) - this.chatRecencyFromRaw(a.raw))
          .slice(0, INBOX_BOOTSTRAP_CHAT_LIMIT)
          .map((row) => row.contactKey),
      );
      profiles.sort((a, b) => {
        const aPri = priorityKeys.has(a.contactKey) ? 1 : 0;
        const bPri = priorityKeys.has(b.contactKey) ? 1 : 0;
        if (aPri !== bPri) return bPri - aPri;
        return a.displayName.length - b.displayName.length;
      });
    }
    profiles = await this.remoteContacts.enrichAvatars(instanceId, profiles, avatarLimit);

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
    if (bootstrap) {
      await this.backfillGroupThreadNames(instanceId).catch(() => 0);
      return { updated, avatars, avatarsStored };
    }

    avatarsStored += await this.contactAvatars.persistMissingAvatarsForInstance(instanceId);
    const avatarRefresh = await this.contactAvatars.refreshAvatarsDetectingChanges(instanceId);
    avatarsStored += avatarRefresh.updated;
    await this.backfillLinkedLeadIdentities(instanceId);
    await this.repairAvatarProfileLinks(instanceId);
    await this.backfillGroupThreadNames(instanceId);
    await this.backfillMessageBodiesFromPayload(instanceId);
    await this.repairReactionMessages(instanceId);
    return { updated, avatars, avatarsStored };
  }

  private async remoteGroupTitlesForInstance(instanceId: string): Promise<Map<string, string>> {
    const now = Date.now();
    const hit = this.remoteGroupTitleCache.get(instanceId);
    if (hit && now - hit.at < 2 * 60_000) return hit.titles;

    await this.refreshRemoteGroupTitleCache(instanceId);
    return this.remoteGroupTitleCache.get(instanceId)?.titles ?? new Map();
  }

  private async refreshRemoteGroupTitleCache(instanceId: string): Promise<void> {
    const profiles = await this.remoteContacts.fetchContactProfiles(instanceId);
    const titles = new Map<string, string>();
    for (const entry of profiles) {
      if (!isGroupContactKey(entry.contactKey)) continue;
      const title = evolutionGroupSubjectTitle(entry.displayName, { trustRemote: true });
      if (title) titles.set(entry.contactKey, title);
    }
    this.remoteGroupTitleCache.set(instanceId, { at: Date.now(), titles });
  }

  private pickAuthoritativeGroupTitle(
    displayName: string | null | undefined,
    contactKey: string,
  ): string | null {
    const auth = evolutionGroupSubjectTitle(displayName, { trustRemote: true });
    if (auth && !isLikelyParticipantName(stripEmojiForNameHeuristic(displayName ?? ''))) {
      return auth;
    }
    const trimmed = stripEmojiForNameHeuristic(displayName ?? '');
    if (
      trimmed &&
      !isGenericGroupThreadName(trimmed, contactKey) &&
      !isLikelyParticipantName(trimmed) &&
      isPlausibleGroupTitle(trimmed)
    ) {
      return trimmed;
    }
    return null;
  }

  private async bestGroupTitleFromStoredPayloads(
    instanceId: string,
    contactKey: string,
  ): Promise<string | null> {
    const rows = await this.messages.find({
      where: { instanceId, contactPhone: contactKey },
      order: { messageAt: 'DESC' },
      take: 40,
      select: ['id', 'mediaPayload'],
    });
    let best: string | null = null;
    for (const row of rows) {
      if (!row.mediaPayload?.trim()) continue;
      try {
        const payload = JSON.parse(row.mediaPayload) as Record<string, unknown>;
        const subject = extractGroupSubjectFromRecord(payload);
        const title =
          evolutionGroupSubjectTitle(subject, { trustRemote: true }) ??
          (subject && isPlausibleGroupTitle(subject) ? subject : null);
        if (!title) continue;
        if (!best || title.length > best.length) best = title;
      } catch {
        /* ignora */
      }
    }
    return best;
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
        evolutionGroupSubjectTitle(entry.displayName, { trustRemote: true }) ??
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
      const remoteTitle =
        remote &&
        (evolutionGroupSubjectTitle(remote.displayName, { trustRemote: true }) ??
          (isPlausibleGroupTitle(remote.displayName) &&
          !isLikelyParticipantName(stripEmojiForNameHeuristic(remote.displayName))
            ? remote.displayName
            : null));
      const currentTitle = this.pickAuthoritativeGroupTitle(profile.displayName, profile.contactKey);
      const contaminated =
        !currentTitle ||
        isGenericGroupThreadName(profile.displayName, profile.contactKey) ||
        isLikelyParticipantName(stripEmojiForNameHeuristic(profile.displayName ?? ''));
      if (!contaminated && currentTitle && remoteTitle && remoteTitle === currentTitle) continue;
      if (!contaminated && currentTitle && !remoteTitle) continue;

      const nextTitle = pickBestGroupThreadName(
        remoteTitle ? [remoteTitle] : [currentTitle, remote?.displayName, profile.displayName],
        profile.contactKey,
      );

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
      const legacyReaction = isReactionPlaceholderBody(row.body);
      if (legacyReaction || row.mediaKind === 'reaction') {
        const target = this.reactionTargetExternalIdFromRow(row);
        const emoji =
          reactionEmojiFromPlaceholderBody(row.body) ||
          (row.mediaKind === 'reaction' ? String(row.body ?? '').trim() : null);
        if (target && emoji) {
          const patch: Partial<EvolutionMessage> = {
            mediaKind: 'reaction',
            reactionTargetExternalId: target,
            body: emoji.slice(0, 2000),
          };
          if (
            row.mediaKind !== 'reaction' ||
            row.reactionTargetExternalId !== target ||
            row.body !== patch.body
          ) {
            await this.messages.update({ id: row.id }, patch);
            updated += 1;
          }
        }
        continue;
      }

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

  async readContactAvatarsBatch(
    items: Array<{ instanceId: string; contactPhone: string }>,
  ): Promise<{
    items: Array<{ threadKey: string; mime: string; base64: string } | { threadKey: string; missing: true }>;
  }> {
    const unique = new Map<string, { instanceId: string; contactPhone: string }>();
    for (const raw of items ?? []) {
      const instanceId = String(raw?.instanceId ?? '').trim();
      const contactPhone = String(raw?.contactPhone ?? '').trim();
      if (!instanceId || !contactPhone) continue;
      unique.set(`${instanceId}:${contactPhone}`, { instanceId, contactPhone });
    }

    const list = [...unique.values()].slice(0, 48);
    const results: Array<
      { threadKey: string; mime: string; base64: string } | { threadKey: string; missing: true }
    > = [];

    const chunkSize = 6;
    for (let offset = 0; offset < list.length; offset += chunkSize) {
      const chunk = list.slice(offset, offset + chunkSize);
      const chunkResults = await Promise.all(
        chunk.map(async (item) => {
          const threadKey = `${item.instanceId}:${item.contactPhone}`;
          try {
            const { buffer, mime } = await this.streamContactAvatar(item.instanceId, item.contactPhone);
            return { threadKey, mime, base64: buffer.toString('base64') };
          } catch {
            return { threadKey, missing: true as const };
          }
        }),
      );
      results.push(...chunkResults);
    }

    return { items: results };
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

  async youtubeLinkPreview(url: string): Promise<{
    videoId: string;
    title: string;
    thumbnailUrl: string;
    watchUrl: string;
  }> {
    const videoId = resolveYouTubeVideoId(url);
    if (!videoId) {
      throw new NotFoundException('Link do YouTube inválido.');
    }

    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const fallbackThumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
      const response = await fetch(oembedUrl, {
        headers: { Accept: 'application/json' },
      });
      if (response.ok) {
        const data = (await response.json()) as { title?: string; thumbnail_url?: string };
        return {
          videoId,
          title: String(data.title ?? '').trim() || 'Vídeo no YouTube',
          thumbnailUrl: String(data.thumbnail_url ?? '').trim() || fallbackThumb,
          watchUrl,
        };
      }
    } catch {
      /* usa fallback */
    }

    return {
      videoId,
      title: 'Vídeo no YouTube',
      thumbnailUrl: fallbackThumb,
      watchUrl,
    };
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

  private expandPhoneContactKeys(digits: string): string[] {
    const normalized = normalizeMobilePhone(digits);
    if (!normalized) return [];
    const keys = new Set<string>([normalized]);
    if (normalized.length === 11) keys.add(`55${normalized}`);
    if (normalized.startsWith('55') && normalized.length >= 12) {
      keys.add(normalized.slice(2));
    }
    return [...keys];
  }

  private collectLeadPhoneDigits(lead: {
    phone?: string | null;
    contacts?: Array<{ phone?: string | null }>;
  }): string[] {
    const digits = new Set<string>();
    if (lead.phone) {
      const main = normalizeMobilePhone(lead.phone);
      if (main) digits.add(main);
    }
    for (const contact of lead.contacts ?? []) {
      const phone = normalizeMobilePhone(contact.phone ?? '');
      if (phone) digits.add(phone);
    }
    return [...digits];
  }

  async linkCommercialLeadToWhatsAppContacts(leadId: string): Promise<void> {
    const lead = await this.commercialLeads.get(leadId);
    const phoneDigits = this.collectLeadPhoneDigits(lead);
    if (!phoneDigits.length) return;

    const contactKeys = new Set<string>();
    for (const digits of phoneDigits) {
      for (const key of this.expandPhoneContactKeys(digits)) contactKeys.add(key);
    }

    const profiles = await this.contactProfiles.find({
      where: { leadId },
      select: ['instanceId', 'contactKey'],
    });
    for (const profile of profiles) {
      if (profile.contactKey?.trim()) contactKeys.add(profile.contactKey.trim());
    }

    const profileRows = contactKeys.size
      ? await this.contactProfiles.find({
          where: { contactKey: In([...contactKeys]) },
        })
      : [];
    for (const existingProfile of profileRows) {
      if (!existingProfile.leadId) {
        existingProfile.leadId = leadId;
        await this.contactProfiles.save(existingProfile);
      }
    }

    if (contactKeys.size) {
      await this.messages
        .createQueryBuilder()
        .update(EvolutionMessage)
        .set({ leadId })
        .where('lead_id IS NULL')
        .andWhere('contact_phone IN (:...keys)', { keys: [...contactKeys] })
        .execute();
    }
  }

  async listCommercialLeadWhatsAppHistory(leadId: string, limit = 150) {
    const lead = await this.commercialLeads.get(leadId);
    await this.linkCommercialLeadToWhatsAppContacts(leadId);

    const phoneDigits = this.collectLeadPhoneDigits(lead);
    const contactKeys = new Set<string>();
    for (const digits of phoneDigits) {
      for (const key of this.expandPhoneContactKeys(digits)) contactKeys.add(key);
    }

    const profiles = await this.contactProfiles.find({
      where: { leadId },
      select: ['instanceId', 'contactKey', 'displayName', 'phoneLabel'],
    });
    for (const profile of profiles) {
      if (profile.contactKey?.trim()) contactKeys.add(profile.contactKey.trim());
    }

    const qb = this.messages.createQueryBuilder('m').where('m.lead_id = :leadId', { leadId });
    if (contactKeys.size) {
      qb.orWhere('m.contact_phone IN (:...contactKeys)', { contactKeys: [...contactKeys] });
    }

    const take = Math.max(1, Math.min(limit, 300));
    const rows = await qb.orderBy('m.message_at', 'DESC').take(take).getMany();
    const instanceIds = [...new Set(rows.map((row) => row.instanceId))];
    const instances = instanceIds.length
      ? await this.instances.find({ where: { id: In(instanceIds) } })
      : [];
    const instanceNameById = new Map(instances.map((row) => [row.id, row.name]));

    const threadMap = new Map<
      string,
      {
        instanceId: string;
        instanceName: string;
        contactPhone: string;
        contactPhoneLabel: string | null;
        lastMessageAt: string | null;
        messageCount: number;
      }
    >();

    for (const row of rows) {
      const threadKey = `${row.instanceId}:${row.contactPhone}`;
      const current = threadMap.get(threadKey);
      const label = formatPhoneLenient(row.contactPhone);
      if (!current) {
        threadMap.set(threadKey, {
          instanceId: row.instanceId,
          instanceName: instanceNameById.get(row.instanceId) ?? 'WhatsApp',
          contactPhone: row.contactPhone,
          contactPhoneLabel: label,
          lastMessageAt: row.messageAt?.toISOString() ?? null,
          messageCount: 1,
        });
      } else {
        current.messageCount += 1;
        const at = row.messageAt?.toISOString() ?? null;
        if (at && (!current.lastMessageAt || at > current.lastMessageAt)) {
          current.lastMessageAt = at;
        }
      }
    }

    const chronological = [...rows].reverse();
    const messages = this.buildThreadMessageList(chronological);
    const threads = [...threadMap.values()].sort(
      (a, b) =>
        new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime(),
    );

    return {
      leadId,
      phones: phoneDigits.map((digits) => formatPhoneLenient(digits)),
      hasPhone: phoneDigits.length > 0,
      threads,
      messages,
    };
  }
}
