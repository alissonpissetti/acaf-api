import type { ParsedEvolutionMessage } from './evolution-inbox.service';
import {
  extractGroupSubjectFromRecord,
  extractPushName,
  formatPhoneLenient,
  isWhatsAppPhoneJid,
  resolveEvolutionContact,
} from './evolution-contact.resolver';
import {
  bodyTextFromWhatsAppMessage,
  buildEvolutionMediaPayload,
  extractEvolutionMedia,
  extractWhatsAppReaction,
  isReactionPlaceholderBody,
  normalizeWhatsAppDeliveryStatus,
  resolveMessageEnvelope,
  type MessageDeliveryAck,
} from './evolution-message-media';

function extractGroupChatName(
  item: Record<string, unknown>,
  key: Record<string, unknown>,
): string | undefined {
  return extractGroupSubjectFromRecord({
    ...item,
    subject: item.subject ?? key.subject,
    groupMetadata: item.groupMetadata ?? key.groupMetadata,
    chat: item.chat ?? key.chat,
  });
}

function extractParticipantLabel(item: Record<string, unknown>, key: Record<string, unknown>): string | null {
  const participant = String(key.participant ?? key.participantAlt ?? '').trim();
  if (!participant) return null;
  const push = extractPushName(item, false);
  if (push) return push;
  const digits = participant.split('@')[0]?.replace(/\D/g, '') ?? '';
  if (digits.length >= 12) {
    const labeled = formatPhoneLenient(digits);
    if (labeled) return labeled;
  }
  return null;
}

function coerceUnixMillis(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw > 1e12 ? raw : raw * 1000;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      if (Number.isFinite(num) && num > 0) return num > 1e12 ? num : num * 1000;
    }
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof raw === 'object') {
    const record = raw as { low?: number; high?: number };
    const low = Number(record.low);
    const high = Number.isFinite(Number(record.high)) ? Number(record.high) : 0;
    if (Number.isFinite(low) && low > 0) {
      const unix = high ? high * 4294967296 + (low >>> 0) : low;
      return unix > 1e12 ? unix : unix * 1000;
    }
  }
  return null;
}

function messageTimestamp(item: Record<string, unknown>, key: Record<string, unknown>): Date {
  const raw =
    item.messageTimestamp ??
    key.messageTimestamp ??
    item.timestamp ??
    (item.message as Record<string, unknown> | undefined)?.messageTimestamp;
  const ms = coerceUnixMillis(raw);
  if (ms != null) return new Date(ms);
  return new Date();
}

export function collectEvolutionMessageRows(data: unknown): unknown[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  if (Array.isArray(record.message)) return record.message;
  if (record.message && typeof record.message === 'object' && (record.key || record.messageType)) {
    return [data];
  }
  if (Array.isArray(record.messages)) return record.messages;
  if (Array.isArray(record.records)) return record.records;
  if (Array.isArray(record.data)) return record.data;
  const nested = record.data;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const inner = nested as Record<string, unknown>;
    if (Array.isArray(inner.messages)) return inner.messages;
    if (inner.key || inner.message || inner.messageType) return [inner];
  }
  if (record.key || record.message || record.messageType) return [data];
  return [];
}

function normalizeEvolutionMessageKey(item: Record<string, unknown>): Record<string, unknown> {
  const messageBlock = item.message;
  const nestedKey =
    messageBlock && typeof messageBlock === 'object'
      ? ((messageBlock as Record<string, unknown>).key as Record<string, unknown> | undefined)
      : undefined;
  const keySource = (item.key ?? item.senderKey ?? nestedKey ?? {}) as Record<string, unknown>;
  const senderPn = String(
    keySource.senderPn ??
      item.senderPn ??
      item.phoneNumber ??
      item.number ??
      (item as Record<string, unknown>).notify ??
      '',
  );
  return {
    ...keySource,
    id: keySource.id ?? item.id,
    fromMe: keySource.fromMe ?? item.fromMe,
    remoteJid: String(keySource.remoteJid ?? item.remoteJid ?? item.chatId ?? ''),
    remoteJidAlt: String(
      keySource.remoteJidAlt ??
        item.remoteJidAlt ??
        (senderPn.includes('@') ? senderPn : ''),
    ),
    participant: String(keySource.participant ?? item.participant ?? ''),
    participantAlt: String(keySource.participantAlt ?? item.participantAlt ?? ''),
    senderPn,
    message: keySource.message ?? item.message,
    messageTimestamp: keySource.messageTimestamp ?? item.messageTimestamp,
  };
}

export function parseEvolutionMessageRow(row: unknown): ParsedEvolutionMessage | null {
  if (!row || typeof row !== 'object') return null;
  const item = row as Record<string, unknown>;
  const key = normalizeEvolutionMessageKey(item);
  const fromMe = Boolean(key.fromMe);
  const resolved = resolveEvolutionContact(key);
  if (!resolved || resolved.contactKey === 'unknown') return null;

  const externalId = String(
    key.id ?? item.id ?? `${resolved.remoteJid}-${messageTimestamp(item, key).getTime()}`,
  );
  const groupName = resolved.isGroup ? extractGroupChatName(item, key) : undefined;
  const pushName = resolved.isGroup ? groupName ?? undefined : extractPushName(item, fromMe);
  const media = extractEvolutionMedia(
    item.message ? item : { ...item, message: key.message },
    key,
  );
  const { inner, rawMessage } = resolveMessageEnvelope(item, key);
  const reactionInfo =
    extractWhatsAppReaction(inner) ||
    extractWhatsAppReaction(rawMessage) ||
    extractWhatsAppReaction((item.message ?? {}) as Record<string, unknown>);
  if (reactionInfo?.targetExternalId) {
    const senderName =
      resolved.isGroup && !fromMe
        ? extractPushName(item, false) ?? extractParticipantLabel(item, key)
        : null;
    const senderJid = resolved.isGroup && !fromMe
      ? String(key.participant ?? key.participantAlt ?? '').trim() || null
      : null;
    const remoteJid = resolved.isGroup ? resolved.remoteJid : String(key.remoteJid ?? resolved.remoteJid);
    return {
      fromMe,
      phone: resolved.phone,
      contactKey: resolved.contactKey,
      remoteJid,
      pushName,
      groupName: groupName ?? null,
      text: reactionInfo.emoji,
      externalId,
      messageAt: messageTimestamp(item, key),
      isGroup: resolved.isGroup,
      mediaKind: 'reaction',
      mediaPayload: buildEvolutionMediaPayload({ ...item, message: rawMessage }, key),
      mediaMimeType: null,
      senderName: senderName ?? null,
      senderJid,
      isReaction: true,
      reactionTargetExternalId: reactionInfo.targetExternalId,
      reactionRemove: reactionInfo.remove,
    };
  }

  let text =
    bodyTextFromWhatsAppMessage(inner) ||
    bodyTextFromWhatsAppMessage((item.message ?? {}) as Record<string, unknown>);
  if (!text && media?.caption) text = media.caption;
  const senderName =
    resolved.isGroup && !fromMe
      ? extractPushName(item, false) ?? extractParticipantLabel(item, key)
      : null;
  const senderJid = resolved.isGroup && !fromMe
    ? String(key.participant ?? key.participantAlt ?? '').trim() || null
    : null;
  if (!text && media) {
    const fallback: Record<string, string> = {
      image: '[imagem]',
      video: '[vídeo]',
      audio: '[áudio]',
      document: '[documento]',
      sticker: '[figurinha]',
    };
    text = fallback[media.kind] ?? '(mensagem)';
  }
  if (!text) text = '(mensagem)';

  if (!reactionInfo && isReactionPlaceholderBody(text)) {
    return null;
  }

  const jidForApi = [String(key.remoteJid ?? ''), String(key.remoteJidAlt ?? item.remoteJidAlt ?? '')]
    .map((value) => value.trim())
    .find((jid) => jid && isWhatsAppPhoneJid(jid));
  const remoteJid = jidForApi || resolved.remoteJid;

  const envelopeItem = item.message ? item : { ...item, message: key.message ?? rawMessage };
  const payloadJson =
    media?.payloadJson ?? buildEvolutionMediaPayload(envelopeItem, key);

  const deliveryStatus =
    normalizeWhatsAppDeliveryStatus(item.status) ??
    normalizeWhatsAppDeliveryStatus(key.status) ??
    (fromMe ? 'sent' : null);

  return {
    fromMe,
    phone: resolved.phone,
    contactKey: resolved.contactKey,
    remoteJid: resolved.isGroup ? resolved.remoteJid : remoteJid,
    pushName,
    groupName: groupName ?? null,
    text,
    externalId,
    messageAt: messageTimestamp(item, key),
    isGroup: resolved.isGroup,
    mediaKind: media?.kind ?? null,
    mediaPayload: payloadJson,
    mediaMimeType: media?.mimeType ?? null,
    senderName: senderName ?? null,
    senderJid,
    deliveryStatus,
  };
}

export type MessageDeliveryUpdate = {
  externalId: string;
  remoteJid: string;
  fromMe: boolean;
  status: MessageDeliveryAck;
};

function readMessageDeliveryUpdate(row: unknown): MessageDeliveryUpdate | null {
  if (!row || typeof row !== 'object') return null;
  const item = row as Record<string, unknown>;
  const key = normalizeEvolutionMessageKey(item);
  const externalId = String(key.id ?? item.id ?? '').trim();
  if (!externalId) return null;

  const update =
    item.update && typeof item.update === 'object'
      ? (item.update as Record<string, unknown>)
      : item;
  const status =
    normalizeWhatsAppDeliveryStatus(update.status) ??
    normalizeWhatsAppDeliveryStatus(item.status) ??
    normalizeWhatsAppDeliveryStatus(key.status);
  if (!status) return null;

  return {
    externalId,
    remoteJid: String(key.remoteJid ?? '').trim(),
    fromMe: Boolean(key.fromMe),
    status,
  };
}

export function parseMessageDeliveryUpdates(data: unknown): MessageDeliveryUpdate[] {
  const rows: unknown[] = [];
  if (Array.isArray(data)) rows.push(...data);
  else if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.updates)) rows.push(...record.updates);
    if (Array.isArray(record.messages)) rows.push(...record.messages);
    if (record.key || record.update || record.status) rows.push(data);
    else rows.push(...collectEvolutionMessageRows(data));
  }
  const seen = new Set<string>();
  const updates: MessageDeliveryUpdate[] = [];
  for (const row of rows) {
    const parsed = readMessageDeliveryUpdate(row);
    if (!parsed) continue;
    const sig = `${parsed.externalId}:${parsed.status}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    updates.push(parsed);
  }
  return updates;
}

export function readEvolutionRowMessageAt(row: unknown): Date | null {
  if (!row || typeof row !== 'object') return null;
  const item = row as Record<string, unknown>;
  const key = (item.key ?? {}) as Record<string, unknown>;
  const at = messageTimestamp(item, key);
  return Number.isNaN(at.getTime()) ? null : at;
}

export function parseEvolutionMessagePayload(data: unknown): ParsedEvolutionMessage[] {
  return collectEvolutionMessageRows(data)
    .map((row) => parseEvolutionMessageRow(row))
    .filter((row): row is ParsedEvolutionMessage => row !== null);
}

export function resolveContactFromEvolutionPayload(data: unknown) {
  if (!data || typeof data !== 'object') return null;
  const key = normalizeEvolutionMessageKey(data as Record<string, unknown>);
  return resolveEvolutionContact(key);
}
