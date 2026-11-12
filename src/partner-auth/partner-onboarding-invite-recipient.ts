import type { AdminNetwork, GymUnit } from '../partner/types';

export type PartnerOnboardingInviteRecipient = {
  email: string;
  source: 'network' | 'unit';
  unitId: string | null;
  scopeType: 'unit' | 'network';
  scopeId: string;
};

function normalizeEmail(value: string | undefined | null): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

export function resolvePartnerOnboardingInviteRecipient(
  network: AdminNetwork,
  unitsInNetwork: GymUnit[],
): PartnerOnboardingInviteRecipient | null {
  const networkEmail = normalizeEmail(network.partnerContactEmail);
  if (networkEmail) {
    return {
      email: networkEmail,
      source: 'network',
      unitId: null,
      scopeType: 'network',
      scopeId: network.id,
    };
  }

  if (unitsInNetwork.length === 1) {
    const unit = unitsInNetwork[0]!;
    const email = normalizeEmail(unit.acafAssociate?.contactEmail);
    if (email) {
      return {
        email,
        source: 'unit',
        unitId: unit.id,
        scopeType: 'unit',
        scopeId: unit.id,
      };
    }
    return null;
  }

  const withEmail = unitsInNetwork.find((u) => normalizeEmail(u.acafAssociate?.contactEmail));
  if (withEmail) {
    const email = normalizeEmail(withEmail.acafAssociate?.contactEmail);
    return {
      email,
      source: 'unit',
      unitId: withEmail.id,
      scopeType: 'unit',
      scopeId: withEmail.id,
    };
  }

  return null;
}

export function todayDateBr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}
