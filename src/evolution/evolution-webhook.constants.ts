/** Eventos de mensagem enviados ao webhook da instância na Evolution API. */
export const EVOLUTION_WEBHOOK_MESSAGE_EVENTS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'MESSAGES_DELETE',
  'MESSAGES_SET',
  'SEND_MESSAGE',
] as const;

/** Eventos de sessão / QR para status da instância. */
export const EVOLUTION_WEBHOOK_SESSION_EVENTS = ['CONNECTION_UPDATE', 'QRCODE_UPDATED'] as const;

export const EVOLUTION_WEBHOOK_EVENTS: string[] = [
  ...EVOLUTION_WEBHOOK_MESSAGE_EVENTS,
  ...EVOLUTION_WEBHOOK_SESSION_EVENTS,
];

export function isEvolutionMessageWebhookEvent(event: string): boolean {
  const normalized = String(event ?? '')
    .trim()
    .toUpperCase()
    .replaceAll('.', '_');
  if (!normalized) return false;
  return EVOLUTION_WEBHOOK_MESSAGE_EVENTS.some(
    (name) => normalized === name || normalized.includes(name),
  );
}
