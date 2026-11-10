export function collectEvolutionChatRows(data: unknown): Record<string, unknown>[] {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object'));
  }
  if (typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  if (Array.isArray(record.chats)) {
    return record.chats.filter(
      (row): row is Record<string, unknown> => Boolean(row && typeof row === 'object'),
    );
  }
  if (Array.isArray(record.data)) {
    return record.data.filter(
      (row): row is Record<string, unknown> => Boolean(row && typeof row === 'object'),
    );
  }
  const jid = String(record.id ?? record.remoteJid ?? record.jid ?? '').trim();
  if (jid) return [record];
  return [];
}

export function readChatUnreadCount(chat: Record<string, unknown>): number | null {
  const raw =
    chat.unreadCount ??
    chat.unread ??
    chat.unreadMessages ??
    (chat as Record<string, unknown>).unreadMentionCount;
  if (raw === undefined || raw === null) return null;
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
}

function readBooleanish(raw: unknown): boolean | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  const text = String(raw).trim().toLowerCase();
  if (text === 'true' || text === '1' || text === 'yes') return true;
  if (text === 'false' || text === '0' || text === 'no') return false;
  return null;
}

export function readChatArchived(chat: Record<string, unknown>): boolean | null {
  const candidates = [
    chat.archived,
    chat.archive,
    chat.isArchived,
    chat.is_archived,
    chat.Archived,
  ];
  for (const raw of candidates) {
    const value = readBooleanish(raw);
    if (value !== null) return value;
  }

  const action = String(chat.action ?? chat.update ?? chat.type ?? '').trim().toLowerCase();
  if (action === 'archive' || action === 'archived') return true;
  if (action === 'unarchive' || action === 'unarchived') return false;

  const nested = chat.chat;
  if (nested && typeof nested === 'object') {
    const inner = readChatArchived(nested as Record<string, unknown>);
    if (inner !== null) return inner;
  }

  const conversation = chat.conversation;
  if (conversation && typeof conversation === 'object') {
    const inner = readChatArchived(conversation as Record<string, unknown>);
    if (inner !== null) return inner;
  }

  const update = chat.update;
  if (update && typeof update === 'object') {
    const inner = readChatArchived(update as Record<string, unknown>);
    if (inner !== null) return inner;
  }

  return null;
}

/** Varre o payload do webhook em busca de pares jid + archived (quando a Evolution repassa o objeto completo). */
export function extractArchiveHintsFromPayload(
  data: unknown,
): Array<{ remoteJid: string; archived: boolean }> {
  const out: Array<{ remoteJid: string; archived: boolean }> = [];
  const seen = new Set<string>();

  const push = (remoteJid: string, archived: boolean) => {
    const jid = remoteJid.trim();
    if (!jid) return;
    const sig = `${jid}:${archived}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push({ remoteJid: jid, archived });
  };

  const visit = (node: unknown, depth = 0) => {
    if (node === null || node === undefined || depth > 12) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const jid = String(record.remoteJid ?? record.id ?? record.jid ?? record.chatId ?? '').trim();
    const archived = readChatArchived(record);
    if (jid && archived !== null) push(jid, archived);
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') visit(value, depth + 1);
    }
  };

  visit(data);
  return out;
}

export function readChatReadTimestamp(chat: Record<string, unknown>): Date | null {
  const raw =
    chat.conversationTimestamp ??
    chat.lastMessageRecvTimestamp ??
    chat.timestamp ??
    chat.t ??
    chat.lastMsgTimestamp;
  if (raw === undefined || raw === null) return null;
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  const ms = num > 1e12 ? num : num * 1000;
  return new Date(ms);
}
