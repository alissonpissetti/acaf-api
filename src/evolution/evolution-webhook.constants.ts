/** Eventos de mensagem enviados ao webhook da instância na Evolution API. */
export const EVOLUTION_WEBHOOK_MESSAGE_EVENTS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'MESSAGES_DELETE',
  'MESSAGES_SET',
  'MESSAGES_EDITED',
  'SEND_MESSAGE',
  'SEND_MESSAGE_UPDATE',
] as const;

/** Atualização de chats (leitura, arquivar, fixar etc.). */
export const EVOLUTION_WEBHOOK_CHAT_EVENTS = [
  'CHATS_UPDATE',
  'CHATS_UPSERT',
  'CHATS_SET',
  'CHATS_DELETE',
] as const;

export const EVOLUTION_WEBHOOK_CONTACT_EVENTS = [
  'CONTACTS_SET',
  'CONTACTS_UPSERT',
  'CONTACTS_UPDATE',
] as const;

/** Nomes aceitos no POST /webhook/set (enum oficial Evolution API v2). */
export const EVOLUTION_WEBHOOK_GROUP_EVENTS = [
  'GROUPS_UPSERT',
  'GROUP_UPDATE',
  'GROUP_PARTICIPANTS_UPDATE',
] as const;

/** Alias que ainda pode vir no corpo do webhook inbound. */
const EVOLUTION_WEBHOOK_GROUP_INBOUND_ALIASES = [
  ...EVOLUTION_WEBHOOK_GROUP_EVENTS,
  'GROUPS_UPDATE',
] as const;

export const EVOLUTION_WEBHOOK_OTHER_EVENTS = [
  'PRESENCE_UPDATE',
  'LABELS_EDIT',
  'LABELS_ASSOCIATION',
  'CALL',
  'APPLICATION_STARTUP',
] as const;

/** Eventos de sessão / QR para status da instância. */
export const EVOLUTION_WEBHOOK_SESSION_EVENTS = ['CONNECTION_UPDATE', 'QRCODE_UPDATED'] as const;

/** Lista completa para registrar no webhook da instância na Evolution. */
export const EVOLUTION_WEBHOOK_EVENTS: string[] = [
  ...EVOLUTION_WEBHOOK_MESSAGE_EVENTS,
  ...EVOLUTION_WEBHOOK_CHAT_EVENTS,
  ...EVOLUTION_WEBHOOK_CONTACT_EVENTS,
  ...EVOLUTION_WEBHOOK_GROUP_EVENTS,
  ...EVOLUTION_WEBHOOK_OTHER_EVENTS,
  ...EVOLUTION_WEBHOOK_SESSION_EVENTS,
];

function normalizeEvolutionEventName(event: string): string {
  return String(event ?? '')
    .trim()
    .toUpperCase()
    .replaceAll('.', '_')
    .replaceAll('-', '_');
}

function eventMatches(event: string, names: readonly string[]): boolean {
  const normalized = normalizeEvolutionEventName(event);
  if (!normalized) return false;
  return names.some((name) => normalized === name || normalized.includes(name));
}

export function isEvolutionContactWebhookEvent(event: string): boolean {
  return eventMatches(event, EVOLUTION_WEBHOOK_CONTACT_EVENTS);
}

export function isEvolutionGroupWebhookEvent(event: string): boolean {
  return eventMatches(event, EVOLUTION_WEBHOOK_GROUP_INBOUND_ALIASES);
}

export function isEvolutionChatWebhookEvent(event: string): boolean {
  return eventMatches(event, EVOLUTION_WEBHOOK_CHAT_EVENTS);
}

export function isEvolutionMessageWebhookEvent(event: string): boolean {
  return eventMatches(event, EVOLUTION_WEBHOOK_MESSAGE_EVENTS);
}
