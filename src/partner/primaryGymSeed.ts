import { normalizeHolderKey } from './checkIn';
import { recomputeConnectPayouts } from './connectPayout';
import type { ApiStore, ConnectMemberRecord, ConnectPlanId, MonthlyPayout } from './types';
import { syncConnectMemberStudent } from './connectMember';

export const CARPE_BATEL_UNIT_ID = 'g_carpe_batel';

function ensureConnectMembersArray(store: ApiStore): ConnectMemberRecord[] {
  if (!Array.isArray(store.connectMembers)) {
    store.connectMembers = [];
  }
  return store.connectMembers;
}

/** Define academia principal sem validar check-ins (operação / seed). */
export function forceAssignPrimaryGym(
  store: ApiStore,
  holderName: string,
  unitId: string,
): ConnectMemberRecord | null {
  const unit = store.units.find((u) => u.id === unitId);
  if (!unit) return null;

  const holderKey = normalizeHolderKey(holderName);
  const members = ensureConnectMembersArray(store);
  const idx = members.findIndex((m) => m.holderKey === holderKey);
  if (idx < 0) return null;

  const current = members[idx];
  const fromUnitId = current.primaryUnitId;
  const now = new Date().toISOString();

  const next: ConnectMemberRecord = {
    ...current,
    primaryUnitId: unitId,
    primaryUnitName: unit.unitName,
    primaryChosenAt: current.primaryChosenAt ?? now,
    primaryFirstCheckInAt: current.primaryFirstCheckInAt ?? '2026-06-15T10:00:00.000Z',
    primaryCheckInsSinceFirst: Math.max(current.primaryCheckInsSinceFirst, 12),
  };
  members[idx] = next;

  if (fromUnitId && fromUnitId !== unitId) {
    store.students = store.students.filter(
      (s) =>
        s.unitId !== fromUnitId ||
        s.channel !== 'connect_primary' ||
        normalizeHolderKey(s.name) !== holderKey,
    );
  }

  syncConnectMemberStudent(store, next);
  return next;
}

function upsertConnectMemberFromStudent(
  store: ApiStore,
  unitId: string,
  unitName: string,
  student: {
    name: string;
    connectPlanId?: ConnectPlanId;
    companyName?: string;
  },
): ConnectMemberRecord {
  const holderKey = normalizeHolderKey(student.name);
  const members = ensureConnectMembersArray(store);
  const idx = members.findIndex((m) => m.holderKey === holderKey);
  const planId = student.connectPlanId ?? 'connect-start';

  const next: ConnectMemberRecord = {
    holderKey,
    holderName: student.name,
    connectPlanId: planId,
    active: true,
    since: idx >= 0 ? members[idx].since : '2026-06-01T00:00:00.000Z',
    primaryUnitId: unitId,
    primaryUnitName: unitName,
    primaryChosenAt: '2026-06-01T00:00:00.000Z',
    primaryFirstCheckInAt: '2026-06-15T10:00:00.000Z',
    primaryCheckInsSinceFirst: 12,
    companyName: student.companyName ?? members[idx]?.companyName,
  };

  if (idx >= 0) {
    members[idx] = { ...members[idx], ...next };
  } else {
    members.push(next);
  }

  syncConnectMemberStudent(store, idx >= 0 ? members[idx] : next);
  return idx >= 0 ? members[idx] : members[members.length - 1];
}

export type BatelPrimarySeedResult = {
  unitId: string;
  unitName: string;
  membersAssigned: number;
  membersCreated: number;
  payoutMonthsRestored: number;
};

/**
 * Associa Batel (Carpe Diem) como academia principal para assinantes Connect da rede
 * e opcionalmente restaura extrato histórico da unidade.
 */
export function applyCarpeBatelPrimaryScenario(
  store: ApiStore,
  opts?: { payoutHistory?: MonthlyPayout[] },
): BatelPrimarySeedResult {
  const unit = store.units.find((u) => u.id === CARPE_BATEL_UNIT_ID);
  if (!unit) {
    throw new Error(`Unidade ${CARPE_BATEL_UNIT_ID} não encontrada no store.`);
  }

  let membersAssigned = 0;
  let membersCreated = 0;
  const membersBefore = (store.connectMembers ?? []).length;

  for (const student of store.students) {
    if (student.unitId !== CARPE_BATEL_UNIT_ID || student.channel !== 'connect_primary') continue;
    if (!student.connectPlanId) continue;
    const existing = store.connectMembers?.find(
      (m) => m.holderKey === normalizeHolderKey(student.name),
    );
    upsertConnectMemberFromStudent(store, unit.id, unit.unitName, {
      name: student.name,
      connectPlanId: student.connectPlanId,
      companyName: student.companyName,
    });
    if (existing) membersAssigned += 1;
    else membersCreated += 1;
  }

  for (const member of store.connectMembers ?? []) {
    if (!member.active) continue;
    const primaryUnit = store.units.find((u) => u.id === member.primaryUnitId);
    const carpeNetwork =
      primaryUnit?.networkId === 'net_carpe' ||
      member.primaryUnitId?.includes('carpe') ||
      unit.networkId === primaryUnit?.networkId;
    if (!carpeNetwork && member.primaryUnitId !== CARPE_BATEL_UNIT_ID) continue;
    if (member.primaryUnitId === CARPE_BATEL_UNIT_ID) continue;
    forceAssignPrimaryGym(store, member.holderName, CARPE_BATEL_UNIT_ID);
    membersAssigned += 1;
  }

  if (store.networkId === 'net_carpe' || store.units.some((u) => u.id === CARPE_BATEL_UNIT_ID)) {
    store.activeUnitId = CARPE_BATEL_UNIT_ID;
  }

  let payoutMonthsRestored = 0;
  if (opts?.payoutHistory?.length) {
    store.payoutHistoryByUnit[CARPE_BATEL_UNIT_ID] = opts.payoutHistory.map((row) => ({ ...row }));
    const last = opts.payoutHistory[opts.payoutHistory.length - 1];
    if (last) {
      store.payoutsByUnit[CARPE_BATEL_UNIT_ID] = { ...last };
    }
    payoutMonthsRestored = opts.payoutHistory.length;
  }

  const membersAfter = (store.connectMembers ?? []).length;
  membersCreated += Math.max(0, membersAfter - membersBefore - membersAssigned);

  recomputeConnectPayouts(store);

  return {
    unitId: unit.id,
    unitName: unit.unitName,
    membersAssigned,
    membersCreated,
    payoutMonthsRestored,
  };
}
