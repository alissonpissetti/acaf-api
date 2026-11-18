import { normalizeHolderKey } from '../partner/checkIn';

/** E-mail sintético estável para titular da assinatura sem login (mesma regra do checkout Asaas). */
export function connectFallbackMemberEmail(holderName: string): string {
  const holderKey = normalizeHolderKey(holderName);
  return `${holderKey.replace(/\s+/g, '.')}@connect.movly.app`;
}

/** Placeholder de titular sem login (checkout/finance) ou espelho legacy em students (@connect.app). */
export function isConnectSyntheticEmail(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase() ?? '';
  if (!normalized || !normalized.includes('@')) return false;
  return normalized.endsWith('@connect.movly.app') || normalized.endsWith('@connect.app');
}

export function isPlatformUserUuid(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed);
}
