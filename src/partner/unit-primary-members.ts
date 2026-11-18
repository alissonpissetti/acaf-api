import type { ApiStore, ConnectMemberRecord, ConnectPlanId } from './types';
import { getDomain } from './store';
import { formatCpf, normalizeCpf } from '../users/person.utils';
import { isConnectSyntheticEmail } from '../asaas/connect-checkout-identity';

export type AdminUnitPrimaryMemberRow = {
  holderKey: string;
  userId?: string;
  name: string;
  email?: string;
  cpf?: string;
  movlyPlanId?: ConnectPlanId;
  movlyPlanName?: string;
  linkedAt?: string;
  active: boolean;
};

function movlyPlanLabel(planId?: ConnectPlanId): string | undefined {
  if (!planId) return undefined;
  const domain = getDomain() as { connectPlans?: Array<{ id: string; name?: string }> };
  const plan = domain.connectPlans?.find((p) => p.id === planId);
  return plan?.name ?? planId;
}

function formatCpfForAdmin(raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined;
  const digits = normalizeCpf(raw);
  if (digits.length !== 11) return raw.trim();
  return formatCpf(digits);
}

export function memberRowFromRecord(member: ConnectMemberRecord): AdminUnitPrimaryMemberRow {
  return {
    holderKey: member.holderKey,
    userId: member.userId?.trim() || undefined,
    name: member.holderName.trim(),
    email: member.holderEmail?.trim() || undefined,
    cpf: formatCpfForAdmin(member.holderCpf),
    movlyPlanId: member.connectPlanId,
    movlyPlanName: movlyPlanLabel(member.connectPlanId),
    linkedAt: member.primaryChosenAt ?? member.since,
    active: member.active,
  };
}

function dedupePrimaryMembersByUserId(
  store: ApiStore,
  rows: AdminUnitPrimaryMemberRow[],
): AdminUnitPrimaryMemberRow[] {
  const memberByKey = new Map((store.connectMembers ?? []).map((m) => [m.holderKey, m]));
  const orphans: AdminUnitPrimaryMemberRow[] = [];
  const byUser = new Map<string, AdminUnitPrimaryMemberRow[]>();

  for (const row of rows) {
    const userId = row.userId?.trim();
    if (!userId) {
      orphans.push(row);
      continue;
    }
    const group = byUser.get(userId) ?? [];
    group.push(row);
    byUser.set(userId, group);
  }

  const picked: AdminUnitPrimaryMemberRow[] = [...orphans];
  for (const group of byUser.values()) {
    if (group.length === 1) {
      picked.push(group[0]);
      continue;
    }
    group.sort((a, b) => {
      const ma = memberByKey.get(a.holderKey);
      const mb = memberByKey.get(b.holderKey);
      if (a.active !== b.active) return a.active ? -1 : 1;
      const ca = ma?.primaryCheckInsSinceFirst ?? 0;
      const cb = mb?.primaryCheckInsSinceFirst ?? 0;
      if (ca !== cb) return cb - ca;
      const aSynthetic = isConnectSyntheticEmail(a.email);
      const bSynthetic = isConnectSyntheticEmail(b.email);
      if (aSynthetic !== bSynthetic) return aSynthetic ? 1 : -1;
      return b.name.length - a.name.length;
    });
    picked.push(group[0]);
  }

  return picked;
}

export function listUnitPrimaryMemberRows(
  store: ApiStore,
  unitId: string,
): AdminUnitPrimaryMemberRow[] {
  const members = (store.connectMembers ?? []).filter((m) => m.primaryUnitId === unitId);
  const rows = members.map(memberRowFromRecord);
  const deduped = dedupePrimaryMembersByUserId(store, rows);
  return deduped.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
}