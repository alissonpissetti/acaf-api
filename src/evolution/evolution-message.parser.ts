import type { ParsedEvolutionMessage } from './evolution-inbox.service';
import {
  extractGroupSubjectFromRecord,
  extractPushName,
  isWhatsAppPhoneJid,
  resolveEvolutionContact,
} from './evolution-contact.resolver';
import {
  bodyTextFromWhatsAppMessage,
  buildEvolutionMediaPayload,
  extractEvolutionMedia,
  extractWhatsAppReaction,
  isReactionPlaceholderBody,
  resolveMessageEnvelope,
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
  if (digits.length >= 10) return digits.slice(-4);
  return null;
}

function messageTimestamp(item: Record<string, unknown>, key: Record<string, unknown>): Date {
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

export function collectEvolutionMessageRows(data: unknown): unknown[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  if (Array.isArray(record.messages)) return record.messages;
  if (Array.isArray(record.records)) return record.records;
  if (Array.isArray(record.data)) return record.data;
  if (record.key || record.message) return [data];
  return [];
}

export function parseEvolutionMessageRow(row: unknown): ParsedEvolutionMessage | null {
  if (!row || typeof row !== 'object') return null;
  const item = row as Record<string, unknown>;
  const key = (item.key ?? {}) as Record<string, unknown>;
  const fromMe = Boolean(key.fromMe);
  const resolved = resolveEvolutionContact({
    ...key,
    remoteJidAlt: String(key.remoteJidAlt ?? item.remoteJidAlt ?? ''),
  });
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
    mediaPayload: media?.payloadJson ?? null,
    mediaMimeType: media?.mimeType ?? null,
    senderName: senderName ?? null,
    senderJid,
  };
}

export function parseEvolutionMessagePayload(data: unknown): ParsedEvolutionMessage[] {
  return collectEvolutionMessageRows(data)
    .map((row) => parseEvolutionMessageRow(row))
    .filter((row): row is ParsedEvolutionMessage => row !== null);
}
