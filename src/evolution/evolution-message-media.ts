export type EvolutionMediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker';

const MEDIA_FIELDS: Array<{ kind: EvolutionMediaKind; field: string }> = [
  { kind: 'image', field: 'imageMessage' },
  { kind: 'video', field: 'videoMessage' },
  { kind: 'audio', field: 'audioMessage' },
  { kind: 'document', field: 'documentMessage' },
  { kind: 'sticker', field: 'stickerMessage' },
];

export type MessageDeliveryAck = 'pending' | 'sent' | 'delivered' | 'read' | 'played';

const DELIVERY_STATUS_BY_NAME: Record<string, MessageDeliveryAck> = {
  PENDING: 'pending',
  SERVER_ACK: 'sent',
  DELIVERY_ACK: 'delivered',
  READ: 'read',
  PLAYED: 'played',
};

export function normalizeWhatsAppDeliveryStatus(raw: unknown): MessageDeliveryAck | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const code = Math.trunc(raw);
    if (code <= 0 || code > 5) return null;
    const byNum: MessageDeliveryAck[] = ['pending', 'sent', 'delivered', 'read', 'played'];
    return byNum[code - 1] ?? null;
  }
  const label = String(raw).trim().toUpperCase().replace(/[^A-Z_]/g, '');
  return DELIVERY_STATUS_BY_NAME[label] ?? null;
}

export function extractDeliveryStatusFromStoredPayload(
  payloadJson: string | null | undefined,
): MessageDeliveryAck | null {
  if (!payloadJson?.trim()) return null;
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const key = (payload.key ?? {}) as Record<string, unknown>;
    return (
      normalizeWhatsAppDeliveryStatus(payload.status) ??
      normalizeWhatsAppDeliveryStatus(key.status) ??
      normalizeWhatsAppDeliveryStatus(
        (payload.update as Record<string, unknown> | undefined)?.status,
      )
    );
  } catch {
    return null;
  }
}

export function mergeDeliveryStatusIntoPayload(
  payloadJson: string,
  status: MessageDeliveryAck,
): string {
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    payload.status = status;
    return JSON.stringify(payload);
  } catch {
    return payloadJson;
  }
}

/** Mesmo critério de reações: IDs do WhatsApp podem vir truncados entre webhook e histórico. */
export function externalMessageIdsMatch(left: string, right: string): boolean {
  const a = String(left ?? '').trim();
  const b = String(right ?? '').trim();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.endsWith(b) || b.endsWith(a)) return true;
  if (a.includes(b) || b.includes(a)) return true;
  return false;
}

export type ParsedEvolutionMedia = {
  kind: EvolutionMediaKind;
  payloadJson: string;
  caption: string | null;
  mimeType: string | null;
};

function readMime(message: Record<string, unknown>, field: string): string | null {
  const part = message[field] as Record<string, unknown> | undefined;
  let mime = String(part?.mimetype ?? part?.mimeType ?? '').trim();
  if (field === 'audioMessage' && !mime) {
    mime = Boolean(part?.ptt) ? 'audio/ogg; codecs=opus' : 'audio/mpeg';
  }
  if (field === 'videoMessage' && !mime) mime = 'video/mp4';
  return mime || null;
}

/** Desembrulha viewOnce, ephemeral, documentWithCaption etc. (Baileys). */
export function unwrapWhatsAppMessageNode(message: Record<string, unknown>): Record<string, unknown> {
  if (!message || typeof message !== 'object') return {};

  const wrappers = [
    'deviceSentMessage',
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'documentWithCaptionMessage',
    'editedMessage',
  ];

  for (const field of wrappers) {
    const wrap = message[field] as Record<string, unknown> | undefined;
    const inner = wrap?.message;
    if (inner && typeof inner === 'object') {
      return unwrapWhatsAppMessageNode(inner as Record<string, unknown>);
    }
  }

  return message;
}

export function resolveMessageEnvelope(item: Record<string, unknown>, key: Record<string, unknown>) {
  const nested = (item.message ?? {}) as Record<string, unknown>;
  const fromNested = Object.keys(nested).length ? nested : null;
  const fromKey = (key.message ?? {}) as Record<string, unknown>;
  const fromKeyMsg = Object.keys(fromKey).length ? fromKey : null;
  const rawMessage = fromNested ?? fromKeyMsg ?? {};
  return {
    rawMessage,
    inner: unwrapWhatsAppMessageNode(rawMessage),
  };
}

export function buildEvolutionMediaPayload(
  item: Record<string, unknown>,
  key: Record<string, unknown>,
): string {
  const messageTimestamp =
    item.messageTimestamp ?? key.messageTimestamp ?? item.timestamp ?? undefined;
  const { rawMessage } = resolveMessageEnvelope(item, key);
  return JSON.stringify({
    key,
    message: rawMessage,
    messageTimestamp,
    pushName: item.pushName,
    status: item.status,
  });
}

export function tryDecodeInlineMediaFromPayload(
  payloadJson: string,
  kind: string | null,
  fallbackMime: string | null,
): { buffer: Buffer; mime: string } | null {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(payloadJson) as Record<string, unknown>;
  } catch {
    return null;
  }

  const key = (payload.key ?? {}) as Record<string, unknown>;
  const { inner } = resolveMessageEnvelope(payload, key);

  for (const { kind: mediaKind, field } of MEDIA_FIELDS) {
    if (kind && kind !== mediaKind) continue;
    const part = inner[field] as Record<string, unknown> | undefined;
    if (!part) continue;

    const direct = String(part.base64 ?? (part as Record<string, unknown>).mediaBase64 ?? '').trim();
    if (direct) {
      const raw = direct.includes(',') ? direct.split(',')[1]! : direct;
      const mime =
        String(part.mimetype ?? part.mimeType ?? fallbackMime ?? '').trim() ||
        (mediaKind === 'image' ? 'image/jpeg' : 'application/octet-stream');
      return { buffer: Buffer.from(raw, 'base64'), mime };
    }

    const thumb = String(part.jpegThumbnail ?? '').trim();
    if (thumb && (mediaKind === 'image' || mediaKind === 'sticker' || kind === 'image')) {
      const raw = thumb.includes(',') ? thumb.split(',')[1]! : thumb;
      return { buffer: Buffer.from(raw, 'base64'), mime: 'image/jpeg' };
    }
  }

  const topBase64 = String(payload.base64 ?? payload.mediaBase64 ?? '').trim();
  if (topBase64) {
    const raw = topBase64.includes(',') ? topBase64.split(',')[1]! : topBase64;
    const mime =
      String(payload.mimetype ?? payload.mimeType ?? fallbackMime ?? '').trim() || 'application/octet-stream';
    return { buffer: Buffer.from(raw, 'base64'), mime };
  }

  return null;
}

export function extractEvolutionMedia(
  item: Record<string, unknown>,
  key: Record<string, unknown>,
): ParsedEvolutionMedia | null {
  const { inner, rawMessage } = resolveMessageEnvelope(item, key);
  if (!inner || typeof inner !== 'object') return null;

  for (const { kind, field } of MEDIA_FIELDS) {
    if (!inner[field]) continue;
    const part = inner[field] as Record<string, unknown>;
    const caption = String(part.caption ?? '').trim() || null;
    const payloadJson = buildEvolutionMediaPayload(
      { ...item, message: rawMessage },
      key,
    );
    return {
      kind,
      payloadJson,
      caption,
      mimeType: readMime(inner, field),
    };
  }

  return null;
}

export type WhatsAppQuotedPreview = {
  externalId: string | null;
  participant: string | null;
  body: string;
  mediaKind: string | null;
};

const MEDIA_FALLBACK_LABELS: Record<string, string> = {
  image: '[imagem]',
  video: '[vídeo]',
  audio: '[áudio]',
  document: '[documento]',
  sticker: '[figurinha]',
};

function contextInfoWithQuote(core: Record<string, unknown>): Record<string, unknown> | null {
  const direct = core.contextInfo as Record<string, unknown> | undefined;
  if (
    direct &&
    (direct.quotedMessage ||
      direct.stanzaId ||
      direct.quotedStanzaId ||
      direct.quotedMessageTimestamp)
  ) {
    return direct;
  }

  const carriers = [
    'extendedTextMessage',
    'imageMessage',
    'videoMessage',
    'audioMessage',
    'documentMessage',
    'stickerMessage',
    'buttonsMessage',
    'listMessage',
    'templateMessage',
    'productMessage',
    'interactiveMessage',
    'buttonsResponseMessage',
    'templateButtonReplyMessage',
    'pinInChatMessage',
  ];
  for (const field of carriers) {
    const part = core[field] as Record<string, unknown> | undefined;
    const ctx = part?.contextInfo as Record<string, unknown> | undefined;
    if (
      ctx &&
      (ctx.quotedMessage ||
        ctx.stanzaId ||
        ctx.quotedStanzaId ||
        ctx.quotedMessageTimestamp)
    ) {
      return ctx;
    }
  }
  const msgContext = core.messageContextInfo as Record<string, unknown> | undefined;
  if (
    msgContext &&
    (msgContext.quotedMessage ||
      msgContext.stanzaId ||
      msgContext.quotedStanzaId)
  ) {
    return msgContext;
  }
  return null;
}

function quotedMessageHasContent(raw: Record<string, unknown> | undefined): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const core = unwrapWhatsAppMessageNode(raw);
  if (bodyTextFromWhatsAppMessage(core) || bodyTextFromWhatsAppMessage(raw)) return true;
  for (const { field } of MEDIA_FIELDS) {
    if (core[field]) return true;
  }
  return Object.keys(core).length > 0;
}

export function extractWhatsAppQuotedPreview(
  message: Record<string, unknown>,
): WhatsAppQuotedPreview | null {
  if (!message || typeof message !== 'object') return null;
  const core = unwrapWhatsAppMessageNode(message);
  const contextInfo = contextInfoWithQuote(core);
  if (!contextInfo) return null;

  const quotedRaw = contextInfo.quotedMessage as Record<string, unknown> | undefined;
  const hasQuotedPayload = quotedMessageHasContent(quotedRaw);

  const externalId = String(
    contextInfo.stanzaId ??
      contextInfo.quotedStanzaId ??
      (contextInfo.quotedMessage as Record<string, unknown> | undefined)?.stanzaId ??
      '',
  ).trim();

  if (!hasQuotedPayload && !externalId) return null;

  const quotedCore =
    quotedRaw && typeof quotedRaw === 'object' ? unwrapWhatsAppMessageNode(quotedRaw) : {};
  let body =
    quotedRaw && typeof quotedRaw === 'object'
      ? bodyTextFromWhatsAppMessage(quotedCore) || bodyTextFromWhatsAppMessage(quotedRaw)
      : '';
  let mediaKind: string | null = null;

  if (!body && quotedRaw && typeof quotedRaw === 'object') {
    for (const { kind, field } of MEDIA_FIELDS) {
      if (quotedCore[field]) {
        mediaKind = kind;
        body = MEDIA_FALLBACK_LABELS[kind] ?? '[mídia]';
        break;
      }
    }
  }

  const participant = String(contextInfo.participant ?? '').trim();

  return {
    externalId: externalId || null,
    participant: participant || null,
    body: body.slice(0, 400),
    mediaKind,
  };
}

export function extractQuotedPreviewFromStoredPayload(
  payloadJson: string | null | undefined,
): WhatsAppQuotedPreview | null {
  if (!payloadJson?.trim()) return null;
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const key = (payload.key ?? {}) as Record<string, unknown>;
    const { inner, rawMessage } = resolveMessageEnvelope(payload, key);
    const candidates: Record<string, unknown>[] = [inner, rawMessage];
    const topMessage = payload.message;
    if (topMessage && typeof topMessage === 'object') {
      candidates.push(topMessage as Record<string, unknown>);
      candidates.push(unwrapWhatsAppMessageNode(topMessage as Record<string, unknown>));
    }
    for (const candidate of candidates) {
      const hit = extractWhatsAppQuotedPreview(candidate);
      if (hit) return hit;
    }
    return null;
  } catch {
    return null;
  }
}

export function bodyTextFromWhatsAppMessage(message: Record<string, unknown>): string {
  const core = unwrapWhatsAppMessageNode(message);
  const extended = core.extendedTextMessage as Record<string, unknown> | undefined;
  const captions: string[] = [];
  for (const { field } of MEDIA_FIELDS) {
    const part = core[field] as Record<string, unknown> | undefined;
    const cap = String(part?.caption ?? '').trim();
    if (cap) captions.push(cap);
  }

  const buttons = core.buttonsMessage as Record<string, unknown> | undefined;
  const template = core.templateMessage as Record<string, unknown> | undefined;
  const hydrated = template?.hydratedTemplate as Record<string, unknown> | undefined;
  const list = core.listMessage as Record<string, unknown> | undefined;
  const reaction = core.reactionMessage as Record<string, unknown> | undefined;
  const document = core.documentMessage as Record<string, unknown> | undefined;
  const contact = core.contactMessage as Record<string, unknown> | undefined;
  const location = core.locationMessage as Record<string, unknown> | undefined;

  const candidates = [
    core.conversation,
    extended?.text,
    buttons?.contentText,
    buttons?.footerText,
    hydrated?.hydratedContentText,
    list?.title,
    list?.description,
    list?.buttonText,
    contact?.displayName,
    location?.name,
    location?.address,
    document?.title,
    document?.fileName,
    ...captions,
  ];

  for (const item of candidates) {
    const text = String(item ?? '').trim();
    if (text) return text;
  }

  return '';
}

export function extractWhatsAppReaction(
  message: Record<string, unknown>,
): { emoji: string; targetExternalId: string; remove: boolean } | null {
  const core = unwrapWhatsAppMessageNode(message);
  const reaction = core.reactionMessage as Record<string, unknown> | undefined;
  if (!reaction) return null;
  const targetKey = (reaction.key ?? {}) as Record<string, unknown>;
  const targetExternalId = String(
    targetKey.id ?? targetKey.stanzaId ?? reaction.stanzaId ?? reaction.msgId ?? '',
  ).trim();
  if (!targetExternalId) return null;
  const emoji = String(reaction.text ?? reaction.emoji ?? '').trim();
  return { emoji, targetExternalId, remove: !emoji };
}

export function isReactionPlaceholderBody(body: string | null | undefined): boolean {
  const text = String(body ?? '').trim();
  if (!text) return false;
  if (/^rea[cç][aã]o:\s*.+/i.test(text)) return true;
  if (/^reaction:\s*.+/i.test(text)) return true;
  if (/^[^:\n]{2,48}:\s*rea[cç][aã]o:\s*.+/i.test(text)) return true;
  return false;
}

export function reactionEmojiFromPlaceholderBody(body: string | null | undefined): string | null {
  let text = String(body ?? '').trim();
  if (!text) return null;
  text = text.replace(/^[^:\n]{2,48}:\s*/u, '').trim();
  text = text.replace(/^rea[cç][aã]o:\s*/i, '').replace(/^reaction:\s*/i, '').trim();
  return text || null;
}

export function extractReactionTargetFromPayloadJson(payloadJson: string | null | undefined): string | null {
  if (!payloadJson?.trim()) return null;
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const key = (payload.key ?? {}) as Record<string, unknown>;
    const { inner, rawMessage } = resolveMessageEnvelope(payload, key);
    return (
      extractWhatsAppReaction(inner)?.targetExternalId ??
      extractWhatsAppReaction(rawMessage)?.targetExternalId ??
      null
    );
  } catch {
    return null;
  }
}
