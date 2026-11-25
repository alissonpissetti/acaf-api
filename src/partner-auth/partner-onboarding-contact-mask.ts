export const MASKED_CONTACT_PLACEHOLDER_EMAIL = 're****@*****.com';
export const MASKED_CONTACT_PLACEHOLDER_PHONE = '(**) *****-****';

export function maskEmailForDisplay(email: string): string {
  const normalized = String(email ?? '').trim().toLowerCase();
  const at = normalized.indexOf('@');
  if (at < 1) return MASKED_CONTACT_PLACEHOLDER_EMAIL;
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const localMask =
    local.length <= 2 ? `${local[0] ?? 'r'}***` : `${local.slice(0, 2)}${'*'.repeat(Math.min(4, local.length - 2))}`;
  const domainParts = domain.split('.').filter(Boolean);
  if (!domainParts.length) return `${localMask}@${MASKED_CONTACT_PLACEHOLDER_EMAIL.split('@')[1]}`;
  const tld =
    domainParts.length >= 2 ? domainParts.slice(-2).join('.') : domainParts[domainParts.length - 1]!;
  const domBase =
    domainParts.length >= 3
      ? domainParts.slice(0, -2).join('.')
      : domainParts.length === 2
        ? domainParts[0]!
        : domainParts[0]!;
  const domMask = domBase.length <= 2 ? `${domBase}***` : `${domBase.slice(0, 2)}***`;
  return `${localMask}@${domMask}.${tld}`;
}

export function maskMobilePhoneForDisplay(digits: string): string {
  const d = String(digits ?? '').replace(/\D/g, '');
  if (d.length !== 11) return MASKED_CONTACT_PLACEHOLDER_PHONE;
  return `(${d.slice(0, 2)}) ${d[2]}****-${d.slice(7)}`;
}

export function maskPersonNameForDisplay(name: string): string {
  const trimmed = String(name ?? '').trim();
  if (trimmed.length < 2) return 'Responsável';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    const p = parts[0]!;
    return p.length <= 2 ? `${p[0]}***` : `${p.slice(0, 2)}***`;
  }
  return `${parts[0]} ${parts[parts.length - 1]!.slice(0, 1)}.`;
}