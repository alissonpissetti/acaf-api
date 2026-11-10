export type EvolutionMediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker';

const MEDIA_FIELDS: Array<{ kind: EvolutionMediaKind; field: string }> = [
  { kind: 'image', field: 'imageMessage' },
  { kind: 'video', field: 'videoMessage' },
  { kind: 'audio', field: 'audioMessage' },
  { kind: 'document', field: 'documentMessage' },
  { kind: 'sticker', field: 'stickerMessage' },
];

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
    reaction?.text ? `Reação: ${String(reaction.text)}` : null,
    ...captions,
  ];

  for (const item of candidates) {
    const text = String(item ?? '').trim();
    if (text) return text;
  }

  return '';
}
