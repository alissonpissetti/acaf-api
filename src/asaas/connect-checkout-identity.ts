import { normalizeHolderKey } from '../partner/checkIn';

/** E-mail sintético estável para titular da assinatura sem login (mesma regra do checkout Asaas). */
export function connectFallbackMemberEmail(holderName: string): string {
  const holderKey = normalizeHolderKey(holderName);
  return `${holderKey.replace(/\s+/g, '.')}@connect.movly.app`;
}

export function isPlatformUserUuid(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed);
}
