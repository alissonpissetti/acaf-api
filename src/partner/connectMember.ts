import type {
  ConnectMemberRecord,
  ConnectPlanId,
  PrimaryGymChangeRecord,
  ApiStore,
  GymStudent,
} from './types';
import { normalizeHolderKey } from './checkIn';
import { loadStore, updateStore } from './store';
import { recomputeConnectPayouts } from './connectPayout';

export const MIN_PRIMARY_CHECKINS_TO_CHANGE = 12;

const CORPORATE_BENEFIT_PER_MONTH = 44.9;

export type ConnectMemberProfile = {
  holderKey: string;
  holderName: string;
  connectPlanId: ConnectPlanId;
  active: boolean;
  since: string;
  primaryUnitId: string | null;
  primaryUnitName: string | null;
  primaryChosenAt: string | null;
  primaryFirstCheckInAt: string | null;
  primaryCheckInsSinceFirst: number;
  canChangePrimary: boolean;
  remainingCheckInsBeforeChange: number;
  minCheckInsToChange: number;
};

export function findConnectMember(store: ApiStore, holderName: string): ConnectMemberRecord | undefined {
  const key = normalizeHolderKey(holderName);
  return store.connectMembers?.find((m) => m.holderKey === key);
}

function ensureConnectMembersArray(store: ApiStore): ConnectMemberRecord[] {
  if (!Array.isArray(store.connectMembers)) {
    store.connectMembers = [];
  }
  return store.connectMembers;
}

function ensurePrimaryGymChangesArray(store: ApiStore): PrimaryGymChangeRecord[] {
  if (!Array.isArray(store.primaryGymChanges)) {
    store.primaryGymChanges = [];
  }
  return store.primaryGymChanges;
}

export function memberCanChangePrimary(member: ConnectMemberRecord): boolean {
  if (!member.primaryFirstCheckInAt) return true;
  return member.primaryCheckInsSinceFirst >= MIN_PRIMARY_CHECKINS_TO_CHANGE;
}

export function remainingCheckInsBeforeChange(member: ConnectMemberRecord): number {
  if (!member.primaryFirstCheckInAt) return 0;
  const left = MIN_PRIMARY_CHECKINS_TO_CHANGE - member.primaryCheckInsSinceFirst;
  return left < 0 ? 0 : left;
}

export function toConnectMemberProfile(member: ConnectMemberRecord): ConnectMemberProfile {
  return {
    holderKey: member.holderKey,
    holderName: member.holderName,
    connectPlanId: member.connectPlanId,
    active: member.active,
    since: member.since,
    primaryUnitId: member.primaryUnitId,
    primaryUnitName: member.primaryUnitName,
    primaryChosenAt: member.primaryChosenAt,
    primaryFirstCheckInAt: member.primaryFirstCheckInAt,
    primaryCheckInsSinceFirst: member.primaryCheckInsSinceFirst,
    canChangePrimary: memberCanChangePrimary(member),
    remainingCheckInsBeforeChange: remainingCheckInsBeforeChange(member),
    minCheckInsToChange: MIN_PRIMARY_CHECKINS_TO_CHANGE,
  };
}

export function upsertConnectSubscription(input: {
  holderName: string;
  connectPlanId: ConnectPlanId;
  active?: boolean;
  companyName?: string;
}): ConnectMemberProfile {
  const holderName = input.holderName.trim();
  if (!holderName) {
    throw new Error('Informe o nome do titular.');
  }
  const holderKey = normalizeHolderKey(holderName);
  const now = new Date().toISOString();

  const store = updateStore((s) => {
    const members = ensureConnectMembersArray(s);
    const idx = members.findIndex((m) => m.holderKey === holderKey);
    const existing = idx >= 0 ? members[idx] : null;

    const next: ConnectMemberRecord = {
      holderKey,
      holderName,
      connectPlanId: input.connectPlanId,
      active: input.active ?? true,
      since: existing?.since ?? now,
      primaryUnitId: existing?.primaryUnitId ?? null,
      primaryUnitName: existing?.primaryUnitName ?? null,
      primaryChosenAt: existing?.primaryChosenAt ?? null,
      primaryFirstCheckInAt: existing?.primaryFirstCheckInAt ?? null,
      primaryCheckInsSinceFirst: existing?.primaryCheckInsSinceFirst ?? 0,
      companyName: input.companyName?.trim() || existing?.companyName,
    };

    if (idx >= 0) {
      members[idx] = next;
    } else {
      members.push(next);
    }

    if (next.primaryUnitId) {
      syncConnectMemberStudent(s, next);
    }
    recomputeConnectPayouts(s);
  });

  const member = findConnectMember(store, holderName);
  if (!member) throw new Error('Falha ao registrar assinatura Connect.');
  return toConnectMemberProfile(member);
}

export function getConnectMemberProfile(holderName: string): ConnectMemberProfile | null {
  const store = loadStore();
  ensureConnectMembersArray(store);
  ensurePrimaryGymChangesArray(store);
  const member = findConnectMember(store, holderName);
  return member ? toConnectMemberProfile(member) : null;
}

export function primaryGymBlockReason(
  store: ApiStore,
  member: ConnectMemberRecord | undefined,
  unitId: string,
): string | null {
  if (!member || !member.active) {
    return 'Ative um plano ACAF Connect antes de escolher sua academia principal.';
  }
  if (member.primaryUnitId === unitId) {
    return 'Esta unidade já é sua academia principal.';
  }
  if (member.primaryUnitId && !memberCanChangePrimary(member)) {
    const left = remainingCheckInsBeforeChange(member);
    return `Faça mais ${left} check-in${left === 1 ? '' : 's'} na ${member.primaryUnitName ?? 'academia principal'} para poder trocar de unidade.`;
  }
  return null;
}

export function setConnectPrimaryGym(holderName: string, unitId: string): ConnectMemberProfile {
  const holderKey = normalizeHolderKey(holderName);
  const preview = loadStore();
  const member = findConnectMember(preview, holderName);
  const block = primaryGymBlockReason(preview, member, unitId);
  if (block) throw new Error(block);

  const unit = preview.units.find((u) => u.id === unitId);
  if (!unit) throw new Error('Unidade não encontrada.');

  const updated = updateStore((s) => {
    const members = ensureConnectMembersArray(s);
    const idx = members.findIndex((m) => m.holderKey === holderKey);
    if (idx < 0) {
      throw new Error('Ative um plano ACAF Connect antes de escolher sua academia principal.');
    }

    const current = members[idx];
    const fromUnitId = current.primaryUnitId;
    const fromUnitName = current.primaryUnitName;
    const now = new Date().toISOString();

    const next: ConnectMemberRecord = {
      ...current,
      primaryUnitId: unitId,
      primaryUnitName: unit.unitName,
      primaryChosenAt: now,
      primaryFirstCheckInAt: null,
      primaryCheckInsSinceFirst: 0,
    };
    members[idx] = next;

    const changes = ensurePrimaryGymChangesArray(s);
    changes.push({
      id: `pgc-${Date.now()}`,
      holderKey,
      fromUnitId,
      fromUnitName,
      toUnitId: unitId,
      toUnitName: unit.unitName,
      changedAt: now,
    });

    removeConnectStudentForHolder(s, holderKey, fromUnitId);
    syncConnectMemberStudent(s, next);
    recomputeConnectPayouts(s);
  });

  const result = findConnectMember(updated, holderName);
  if (!result) throw new Error('Falha ao definir academia principal.');
  return toConnectMemberProfile(result);
}

export function validateConnectCheckInAtUnit(
  store: ApiStore,
  holderName: string,
  unitId: string,
): string | null {
  const member = findConnectMember(store, holderName);
  if (!member?.active) {
    return 'Plano ACAF Connect não encontrado ou inativo. Ative sua assinatura no app.';
  }
  if (!member.primaryUnitId) {
    return 'Escolha sua academia principal no app antes do check-in com plano mensal.';
  }
  if (member.primaryUnitId !== unitId) {
    return `Check-in com plano só na sua academia principal (${member.primaryUnitName ?? member.primaryUnitId}). Nesta unidade, use diária.`;
  }
  return null;
}

export function recordConnectMemberCheckIn(store: ApiStore, holderName: string, unitId: string): void {
  const members = ensureConnectMembersArray(store);
  const member = findConnectMember(store, holderName);
  if (!member || member.primaryUnitId !== unitId) return;

  const now = new Date().toISOString();
  const idx = members.findIndex((m) => m.holderKey === member.holderKey);
  if (idx < 0) return;

  const current = members[idx];
  if (!current.primaryFirstCheckInAt) {
    members[idx] = {
      ...current,
      primaryFirstCheckInAt: now,
      primaryCheckInsSinceFirst: 1,
    };
  } else {
    members[idx] = {
      ...current,
      primaryCheckInsSinceFirst: current.primaryCheckInsSinceFirst + 1,
    };
  }

  syncConnectMemberStudent(store, members[idx]);
}

/** Recalcula contagem de check-ins na academia principal após remoção manual (admin). */
export function refreshConnectMemberPrimaryStatsFromLog(store: ApiStore, holderName: string): void {
  const members = ensureConnectMembersArray(store);
  const member = findConnectMember(store, holderName);
  if (!member?.primaryUnitId || !member.primaryChosenAt) return;

  const holderKey = normalizeHolderKey(holderName);
  const entries = store.checkInLog
    .filter(
      (e) =>
        e.type === 'connect_member' &&
        e.unitId === member.primaryUnitId &&
        normalizeHolderKey(e.holderName) === holderKey &&
        e.validatedAt >= member.primaryChosenAt!,
    )
    .sort((a, b) => a.validatedAt.localeCompare(b.validatedAt));

  const idx = members.findIndex((m) => m.holderKey === member.holderKey);
  if (idx < 0) return;

  members[idx] = {
    ...members[idx],
    primaryCheckInsSinceFirst: entries.length,
    primaryFirstCheckInAt: entries[0]?.validatedAt ?? null,
  };
  syncConnectMemberStudent(store, members[idx]);
}

function removeConnectStudentForHolder(
  store: ApiStore,
  holderKey: string,
  unitId: string | null,
): void {
  if (!unitId) return;
  store.students = store.students.filter(
    (s) =>
      s.unitId !== unitId ||
      s.channel !== 'connect_primary' ||
      normalizeHolderKey(s.name) !== holderKey,
  );
}

export function syncConnectMemberStudent(store: ApiStore, member: ConnectMemberRecord): void {
  if (!member.primaryUnitId || !member.active) return;

  const unit = store.units.find((u) => u.id === member.primaryUnitId);
  if (!unit) return;

  store.students = store.students.filter(
    (s) => s.channel !== 'connect_primary' || normalizeHolderKey(s.name) !== member.holderKey,
  );

  const emailSlug = member.holderKey.replace(/\s+/g, '.');
  const studentId = `cm-${member.holderKey.replace(/\s+/g, '-')}`;

  let student: GymStudent = {
    id: studentId,
    unitId: member.primaryUnitId,
    name: member.holderName,
    email: `${emailSlug}@connect.acaf.app`,
    channel: 'connect_primary',
    connectPlanId: member.connectPlanId,
    corporateBenefitPerMonth: CORPORATE_BENEFIT_PER_MONTH,
    companyName: member.companyName,
    checkInsThisMonth: 0,
    lastVisit: '—',
    dailyPassesThisMonth: 0,
  };

  const idx = store.students.findIndex((s) => s.id === studentId);
  if (idx >= 0) {
    const prev = store.students[idx];
    store.students[idx] = {
      ...student,
      checkInsThisMonth: prev.checkInsThisMonth,
      lastVisit: prev.lastVisit,
      dailyPassesThisMonth: prev.dailyPassesThisMonth,
    };
  } else {
    store.students.push(student);
  }
}
