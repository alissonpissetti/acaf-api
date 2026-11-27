import type { AdminNetwork, GymUnit } from '../partner/types';
import { isValidMobilePhone, normalizeMobilePhone } from '../users/person.utils';

export type PartnerOnboardingInviteRecipient = {
  /** Exibição no admin (vários endereços unidos com ` / `). */
  email: string;
  /** Destinatários individuais para envio. */
  emails: string[];
  source: 'network' | 'unit';
  unitId: string | null;
  scopeType: 'unit' | 'network';
  scopeId: string;
};

const CONTACT_EMAIL_SPLIT = /[/,;]+/;

function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Aceita um ou vários e-mails no mesmo campo (`a@x.com / b@x.com`). */
export function parseContactEmailList(value: string | undefined | null): string[] {
  const raw = String(value ?? '').trim();
  if (!raw) return [];

  const parts = raw
    .split(CONTACT_EMAIL_SPLIT)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    if (!isPlausibleEmail(part)) continue;
    if (seen.has(part)) continue;
    seen.add(part);
    out.push(part);
  }
  return out;
}

export function formatContactEmailsForDisplay(emails: string[]): string {
  return emails.join(' / ');
}

export function contactEmailIsInviteRecipient(
  recipient: PartnerOnboardingInviteRecipient,
  email: string,
): boolean {
  const normalized = email.trim().toLowerCase();
  return recipient.emails.includes(normalized);
}

function recipientFromEmails(
  emails: string[],
  source: 'network' | 'unit',
  scope: { scopeType: 'unit' | 'network'; scopeId: string; unitId: string | null },
): PartnerOnboardingInviteRecipient {
  return {
    email: formatContactEmailsForDisplay(emails),
    emails,
    source,
    unitId: scope.unitId,
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
  };
}

export function resolvePartnerOnboardingInviteRecipient(
  network: AdminNetwork,
  unitsInNetwork: GymUnit[],
): PartnerOnboardingInviteRecipient | null {
  const networkEmails = parseContactEmailList(network.partnerContactEmail);
  if (networkEmails.length) {
    return recipientFromEmails(networkEmails, 'network', {
      scopeType: 'network',
      scopeId: network.id,
      unitId: null,
    });
  }

  if (unitsInNetwork.length === 1) {
    const unit = unitsInNetwork[0]!;
    const emails = parseContactEmailList(unit.acafAssociate?.contactEmail);
    if (emails.length) {
      return recipientFromEmails(emails, 'unit', {
        scopeType: 'unit',
        scopeId: unit.id,
        unitId: unit.id,
      });
    }
    return null;
  }

  const withEmail = unitsInNetwork.find((u) => parseContactEmailList(u.acafAssociate?.contactEmail).length > 0);
  if (withEmail) {
    const emails = parseContactEmailList(withEmail.acafAssociate?.contactEmail);
    return recipientFromEmails(emails, 'unit', {
      scopeType: 'unit',
      scopeId: withEmail.id,
      unitId: withEmail.id,
    });
  }

  return null;
}

export function todayDateBr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

/** Celular do contato principal cadastrado no admin (rede). */
export function resolvePartnerContactPhone(network: AdminNetwork): string | null {
  const digits = normalizeMobilePhone(network.partnerContactPhone ?? '');
  if (!isValidMobilePhone(digits)) return null;
  return digits;
}

export function resolvePartnerContactName(network: AdminNetwork): string | null {
  const name = String(network.partnerContactName ?? '').trim();
  return name.length >= 2 ? name : null;
}
