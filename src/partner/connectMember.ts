import type {
  CheckInLogEntry,
  ConnectMemberRecord,
  ConnectPlanId,
  ConnectSavedPaymentMethodRecord,
  PrimaryGymChangeRecord,
  ApiStore,
  GymStudent,
} from './types';
import {
  hasCheckInTodayForPerson,
  hasPendingCheckInTodayForPerson,
  normalizeHolderKey,
} from './checkIn';
import { brDateKeyFromIso, brDateKeyToday } from './gymLocalTime';
import { loadStore, updateStore } from './store';
import { isConnectSyntheticEmail } from '../asaas/connect-checkout-identity';
import { normalizeCpf } from '../users/person.utils';
import { recomputeConnectPayouts } from './connectPayout';
import {
  DEFAULT_GYM_SWITCH_MIN_CHECKINS_AT_UNIT,
  getGymSwitchMinCheckinsAtUnitFromMemory,
} from '../system-settings/system-settings.service';

/** @deprecated use getGymSwitchMinCheckinsAtUnitFromMemory() */
export const MIN_PRIMARY_CHECKINS_TO_CHANGE = DEFAULT_GYM_SWITCH_MIN_CHECKINS_AT_UNIT;

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
  asaasSubscriptionId?: string | null;
  cardLastFour?: string | null;
  savedPaymentMethods?: Array<{
    id: string;
    brand: string;
    lastFour: string;
    holderName: string;
    expiryMonth: string;
    expiryYear: string;
    isDefault: boolean;
    addedAt: string;
    usedForSubscription?: boolean;
    hasAsaasToken?: boolean;
    addedByUserId?: string;
  }>;
  planChangeReceivableAmount?: number | null;
  planChangeReceivableId?: string | null;
  lastPlanChangeAt?: string | null;
  lastPlanChangeFromPlanId?: ConnectPlanId | null;
  unitSubscription?: {
    unitId: string;
    unitName: string;
    planId: string;
    connectPlanId: ConnectPlanId;
    planName: string;
    pricePerMonth: number;
    since: string;
  } | null;
  /** Check-in confirmado na recepção hoje (rede/plano). */
  confirmedCheckInToday: boolean;
  /** Solicitação enviada pelo app aguardando confirmação do parceiro. */
  pendingCheckInToday: boolean;
};

export function findConnectMember(store: ApiStore, holderName: string): ConnectMemberRecord | undefined {
  const key = normalizeHolderKey(holderName);
  if (!key) return undefined;
  return store.connectMembers?.find((m) => m.holderKey === key);
}

/** Resolve titular no check-in: JWT (userId) tem prioridade sobre o nome enviado pelo app. */
export function findConnectMemberForCheckIn(
  store: ApiStore,
  holderName: string,
  userId?: string | null,
): ConnectMemberRecord | undefined {
  const byUser = userId?.trim() ? findConnectMemberByUserId(store, userId) : undefined;
  if (byUser) return byUser;
  return findConnectMember(store, holderName);
}

export function findConnectMemberByAsaasSubscriptionId(
  store: ApiStore,
  subscriptionId: string,
): ConnectMemberRecord | undefined {
  const id = subscriptionId.trim();
  if (!id) return undefined;
  return store.connectMembers?.find((m) => m.asaasSubscriptionId?.trim() === id);
}

export function findConnectMemberByUserId(
  store: ApiStore,
  userId: string,
): ConnectMemberRecord | undefined {
  const id = userId.trim();
  if (!id) return undefined;
  return store.connectMembers?.find((m) => m.userId?.trim() === id);
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

function minPrimaryCheckInsToChange(): number {
  return getGymSwitchMinCheckinsAtUnitFromMemory();
}

export function memberCanChangePrimary(member: ConnectMemberRecord): boolean {
  if (!member.primaryUnitId) return true;
  return member.primaryCheckInsSinceFirst >= minPrimaryCheckInsToChange();
}

export function remainingCheckInsBeforeChange(member: ConnectMemberRecord): number {
  if (!member.primaryUnitId) return 0;
  const left = minPrimaryCheckInsToChange() - member.primaryCheckInsSinceFirst;
  return left < 0 ? 0 : left;
}

function mapSavedPaymentMethodForClient(
  method: ConnectSavedPaymentMethodRecord,
): NonNullable<ConnectMemberProfile['savedPaymentMethods']>[number] {
  return {
    id: method.id,
    brand: method.brand,
    lastFour: method.lastFour,
    holderName: method.holderName,
    expiryMonth: method.expiryMonth,
    expiryYear: method.expiryYear,
    isDefault: method.isDefault,
    addedAt: method.addedAt,
    usedForSubscription: method.usedForSubscription,
    hasAsaasToken: Boolean(method.asaasToken?.trim()),
    addedByUserId: method.addedByUserId,
  };
}

function memberCheckInDayFlags(
  store: ApiStore,
  member: ConnectMemberRecord,
): { confirmedCheckInToday: boolean; pendingCheckInToday: boolean } {
  const unitId = member.primaryUnitId ?? '';
  const confirmed = unitId
    ? hasCheckInTodayForPerson(store, unitId, member.holderName, 'connect_member', '')
    : false;
  const pending = hasPendingCheckInTodayForPerson(store, member.holderName, 'connect_member');
  return { confirmedCheckInToday: confirmed, pendingCheckInToday: pending };
}

export function toConnectMemberProfile(member: ConnectMemberRecord, store?: ApiStore): ConnectMemberProfile {
  const loaded = store ?? loadStore();
  const dayFlags = memberCheckInDayFlags(loaded, member);
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
    minCheckInsToChange: minPrimaryCheckInsToChange(),
    asaasSubscriptionId: member.asaasSubscriptionId ?? null,
    cardLastFour: member.cardLastFour ?? null,
    savedPaymentMethods: (member.savedPaymentMethods ?? []).map(mapSavedPaymentMethodForClient),
    planChangeReceivableAmount: member.planChangeReceivableAmount ?? null,
    planChangeReceivableId: member.planChangeReceivableId ?? null,
    lastPlanChangeAt: member.lastPlanChangeAt ?? null,
    lastPlanChangeFromPlanId: member.lastPlanChangeFromPlanId ?? null,
    unitSubscription: member.unitSubscription
      ? {
          unitId: member.unitSubscription.unitId,
          unitName: member.unitSubscription.unitName,
          planId: member.unitSubscription.planId,
          connectPlanId: member.unitSubscription.connectPlanId,
          planName: member.unitSubscription.planName,
          pricePerMonth: member.unitSubscription.pricePerMonth,
          since: member.unitSubscription.since,
        }
      : null,
    confirmedCheckInToday: dayFlags.confirmedCheckInToday,
    pendingCheckInToday: dayFlags.pendingCheckInToday,
  };
}

export function upsertConnectSubscription(input: {
  holderName: string;
  connectPlanId: ConnectPlanId;
  active?: boolean;
  companyName?: string;
  asaasCustomerId?: string;
  asaasSubscriptionId?: string;
  cardLastFour?: string;
  userId?: string;
  holderCpf?: string;
  holderEmail?: string;
  holderPhone?: string;
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
      asaasCustomerId: input.asaasCustomerId ?? existing?.asaasCustomerId,
      asaasSubscriptionId: input.asaasSubscriptionId ?? existing?.asaasSubscriptionId,
      cardLastFour: input.cardLastFour ?? existing?.cardLastFour,
      savedPaymentMethods: existing?.savedPaymentMethods,
      userId: input.userId ?? existing?.userId,
      holderCpf: input.holderCpf ?? existing?.holderCpf,
      holderEmail: input.holderEmail ?? existing?.holderEmail,
      holderPhone: input.holderPhone ?? existing?.holderPhone,
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
  if (!member) throw new Error('Falha ao registrar assinatura de plano.');
  return toConnectMemberProfile(member);
}

export function getConnectMemberProfile(holderName: string): ConnectMemberProfile | null {
  const store = loadStore();
  ensureConnectMembersArray(store);
  ensurePrimaryGymChangesArray(store);
  const member = findConnectMember(store, holderName);
  return member ? toConnectMemberProfile(member) : null;
}

export function getConnectMemberProfileByUserId(userId: string): ConnectMemberProfile | null {
  const id = userId.trim();
  if (!id) return null;
  const store = loadStore();
  ensureConnectMembersArray(store);
  const member = findConnectMemberByUserId(store, id);
  return member ? toConnectMemberProfile(member) : null;
}

export type ConnectMemberCheckInItem = {
  id: string;
  unitId: string;
  unitName: string;
  type: CheckInLogEntry['type'];
  modalityLabel: string;
  validatedAt: string;
  status: 'validated' | 'pending_partner';
};

function unitDisplayName(store: ApiStore, unitId: string): string {
  const unit = store.units.find((u) => u.id === unitId);
  if (!unit) return unitId;
  return unit.unitName?.trim() || unit.neighborhood || unitId;
}

function checkInModalityLabel(type: CheckInLogEntry['type']): string {
  return type === 'daily_pass' ? 'Diária' : 'Plano Movly';
}

export function listConnectMemberCheckInsForUser(
  userId: string,
  options?: { limit?: number; offset?: number },
): { items: ConnectMemberCheckInItem[]; total: number } {
  const id = userId.trim();
  if (!id) return { items: [], total: 0 };

  const store = loadStore();
  const member = findConnectMemberByUserId(store, id);
  if (!member) return { items: [], total: 0 };

  const holderKey = member.holderKey;
  const today = brDateKeyToday();
  const confirmed = store.checkInLog
    .filter((e) => normalizeHolderKey(e.holderName) === holderKey)
    .map((e) => ({
      id: e.id,
      unitId: e.unitId,
      unitName: unitDisplayName(store, e.unitId),
      type: e.type,
      modalityLabel: checkInModalityLabel(e.type),
      validatedAt: e.validatedAt,
      status: 'validated' as const,
    }));

  const pending = (store.pendingCheckIns ?? [])
    .filter(
      (p) =>
        p.status === 'pending' &&
        p.type === 'connect_member' &&
        normalizeHolderKey(p.holderName) === holderKey &&
        brDateKeyFromIso(p.requestedAt) === today,
    )
    .map((p) => ({
      id: p.id,
      unitId: p.unitId,
      unitName: unitDisplayName(store, p.unitId),
      type: p.type,
      modalityLabel: checkInModalityLabel(p.type),
      validatedAt: p.requestedAt,
      status: 'pending_partner' as const,
    }));

  const all = [...pending, ...confirmed].sort((a, b) =>
    b.validatedAt.localeCompare(a.validatedAt),
  );

  const total = all.length;
  const limit = Math.min(Math.max(options?.limit ?? 30, 1), 100);
  const offset = Math.max(options?.offset ?? 0, 0);
  const slice = all.slice(offset, offset + limit);

  const items = slice;

  return { items, total };
}

export function primaryGymBlockReason(
  store: ApiStore,
  member: ConnectMemberRecord | undefined,
  unitId: string,
): string | null {
  if (!member || !member.active) {
    return 'Ative um plano app antes de escolher sua academia principal.';
  }
  if (member.primaryUnitId === unitId) {
    return 'Esta unidade já é sua academia principal.';
  }
  if (member.primaryUnitId && !memberCanChangePrimary(member)) {
    const min = minPrimaryCheckInsToChange();
    const done = member.primaryCheckInsSinceFirst;
    const left = remainingCheckInsBeforeChange(member);
    return `${done} de ${min} check-ins confirmados na ${member.primaryUnitName ?? 'academia principal'}. `
      + `Faça mais ${left} check-in${left === 1 ? '' : 's'} para poder trocar de unidade.`;
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
      throw new Error('Ative um plano app antes de escolher sua academia principal.');
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
  options?: { userId?: string | null },
): string | null {
  const member = findConnectMemberForCheckIn(store, holderName, options?.userId);
  if (!member) {
    if (options?.userId?.trim()) {
      return 'Não vinculamos sua conta a uma assinatura Movly ativa. Abra Minha conta, confira o plano ou fale com o suporte.';
    }
    const key = normalizeHolderKey(holderName);
    if (!key || key === 'associado') {
      return 'Não identificamos sua assinatura Movly neste check-in. Entre na sua conta no app e tente de novo.';
    }
    return 'Não encontramos assinatura Movly para este titular. Entre na sua conta (Minha conta) ou use o mesmo nome da assinatura.';
  }
  if (!member.active) {
    return 'Sua assinatura Movly está inativa. Ative ou renove o plano em Minha conta antes do check-in.';
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

function clearConnectPrimaryStudentsForHolder(store: ApiStore, holderKey: string): void {
  store.students = store.students.filter(
    (s) => s.channel !== 'connect_primary' || normalizeHolderKey(s.name) !== holderKey,
  );
}

function pickCanonicalConnectMember(members: ConnectMemberRecord[]): ConnectMemberRecord {
  return [...members].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    const checkA = a.primaryCheckInsSinceFirst ?? 0;
    const checkB = b.primaryCheckInsSinceFirst ?? 0;
    if (checkA !== checkB) return checkB - checkA;
    if (Boolean(a.asaasSubscriptionId) !== Boolean(b.asaasSubscriptionId)) {
      return a.asaasSubscriptionId ? -1 : 1;
    }
    if (Boolean(a.primaryUnitId) !== Boolean(b.primaryUnitId)) {
      return a.primaryUnitId ? -1 : 1;
    }
    return b.holderName.length - a.holderName.length;
  })[0]!;
}

export function findConnectMemberForPlatformUser(
  store: ApiStore,
  user: { id: string; name: string; email: string; cpf?: string | null },
): ConnectMemberRecord | undefined {
  const members = ensureConnectMembersArray(store);
  return findBestConnectMemberForUser(members, user);
}

function findBestConnectMemberForUser(
  members: ConnectMemberRecord[],
  user: { id: string; name: string; email: string; cpf?: string | null },
): ConnectMemberRecord | undefined {
  const byUserId = members.find((m) => m.userId?.trim() === user.id);
  if (byUserId) return byUserId;

  const cpf = user.cpf ? normalizeCpf(user.cpf) : '';
  if (cpf) {
    const byCpf = members.find((m) => m.holderCpf && normalizeCpf(m.holderCpf) === cpf);
    if (byCpf) return byCpf;
  }

  const email = user.email.trim().toLowerCase();
  const byEmail = members.find(
    (m) => m.holderEmail?.trim().toLowerCase() === email,
  );
  if (byEmail) return byEmail;

  const holderKey = normalizeHolderKey(user.name);
  return members.find((m) => m.holderKey === holderKey);
}

/**
 * Unifica titular no JSON store: nome/e-mail reais do usuário, desativa registros duplicados do mesmo userId.
 */
export function reconcileConnectMemberForPlatformUser(
  store: ApiStore,
  user: { id: string; name: string; email: string; cpf?: string | null },
): void {
  const members = ensureConnectMembersArray(store);
  const matched = findBestConnectMemberForUser(members, user);
  if (!matched) return;

  const userName = user.name.trim();
  const userEmail = user.email.trim();
  const userCpf = user.cpf ? normalizeCpf(user.cpf) : '';

  const next: ConnectMemberRecord = {
    ...matched,
    userId: user.id,
    holderName: userName || matched.holderName,
    holderEmail: isConnectSyntheticEmail(userEmail)
      ? matched.holderEmail && !isConnectSyntheticEmail(matched.holderEmail)
        ? matched.holderEmail
        : userEmail
      : userEmail,
    holderCpf: userCpf || matched.holderCpf,
  };

  const idx = members.findIndex((m) => m.holderKey === next.holderKey);
  if (idx >= 0) {
    members[idx] = next;
  }

  const sameUser = members.filter((m) => m.userId?.trim() === user.id);
  if (sameUser.length <= 1) {
    if (next.primaryUnitId && next.active) syncConnectMemberStudent(store, next);
    return;
  }

  const canonical = pickCanonicalConnectMember(
    sameUser.map((m) => (m.holderKey === next.holderKey ? next : m)),
  );
  const merged: ConnectMemberRecord = {
    ...canonical,
    userId: user.id,
    holderName: userName || canonical.holderName,
    holderEmail: isConnectSyntheticEmail(userEmail)
      ? canonical.holderEmail && !isConnectSyntheticEmail(canonical.holderEmail)
        ? canonical.holderEmail
        : userEmail
      : userEmail,
    holderCpf: userCpf || canonical.holderCpf,
  };

  const canonIdx = members.findIndex((m) => m.holderKey === canonical.holderKey);
  if (canonIdx >= 0) members[canonIdx] = merged;

  for (const duplicate of sameUser) {
    if (duplicate.holderKey === merged.holderKey) continue;

    if (!merged.primaryUnitId && duplicate.primaryUnitId && duplicate.active) {
      merged.primaryUnitId = duplicate.primaryUnitId;
      merged.primaryUnitName = duplicate.primaryUnitName;
      merged.primaryChosenAt = duplicate.primaryChosenAt ?? merged.primaryChosenAt;
      merged.primaryFirstCheckInAt = duplicate.primaryFirstCheckInAt ?? merged.primaryFirstCheckInAt;
      merged.primaryCheckInsSinceFirst = Math.max(
        merged.primaryCheckInsSinceFirst ?? 0,
        duplicate.primaryCheckInsSinceFirst ?? 0,
      );
      merged.connectPlanId = duplicate.connectPlanId ?? merged.connectPlanId;
      merged.active = duplicate.active;
      merged.asaasSubscriptionId = duplicate.asaasSubscriptionId ?? merged.asaasSubscriptionId;
      merged.companyName = duplicate.companyName ?? merged.companyName;
      if (canonIdx >= 0) members[canonIdx] = merged;
    }

    const dupIdx = members.findIndex((m) => m.holderKey === duplicate.holderKey);
    if (dupIdx < 0) continue;
    members[dupIdx] = {
      ...members[dupIdx],
      active: false,
      primaryUnitId: null,
      primaryUnitName: null,
      userId: user.id,
    };
    clearConnectPrimaryStudentsForHolder(store, duplicate.holderKey);
  }

  if (merged.primaryUnitId && merged.active) syncConnectMemberStudent(store, merged);
}

export function syncConnectMemberStudent(store: ApiStore, member: ConnectMemberRecord): void {
  if (!member.primaryUnitId || !member.active) return;

  const unit = store.units.find((u) => u.id === member.primaryUnitId);
  if (!unit) return;

  store.students = store.students.filter(
    (s) => s.channel !== 'connect_primary' || normalizeHolderKey(s.name) !== member.holderKey,
  );

  const studentId = `cm-${member.holderKey.replace(/\s+/g, '-')}`;
  const memberEmail = member.holderEmail?.trim();
  const resolvedEmail =
    memberEmail && !isConnectSyntheticEmail(memberEmail)
      ? memberEmail
      : undefined;

  let student: GymStudent = {
    id: studentId,
    unitId: member.primaryUnitId,
    name: member.holderName,
    email: resolvedEmail ?? '',
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

function ensureSavedPaymentMethods(member: ConnectMemberRecord): ConnectSavedPaymentMethodRecord[] {
  if (!Array.isArray(member.savedPaymentMethods)) {
    member.savedPaymentMethods = [];
  }
  return member.savedPaymentMethods;
}

/** App local ids são `card-*`; resolve por últimos dígitos quando o cliente ainda não sincronizou. */
export function findConnectSavedPaymentMethod(
  methods: ConnectSavedPaymentMethodRecord[],
  paymentMethodId: string,
): ConnectSavedPaymentMethodRecord | undefined {
  const trimmed = paymentMethodId.trim();
  const byId = methods.find((m) => m.id === trimmed);
  if (byId) return byId;
  if (trimmed.startsWith('card-')) {
    const tail = trimmed.slice('card-'.length);
    if (/^\d{4}$/.test(tail)) {
      return methods.find((m) => m.lastFour === tail);
    }
  }
  return undefined;
}

export type UpsertConnectSavedPaymentMethodInput = {
  holderName: string;
  brand: string;
  lastFour: string;
  holderNameOnCard: string;
  expiryMonth: string;
  expiryYear: string;
  makeDefault: boolean;
  billingCardLastFour?: string;
  usedForSubscription?: boolean;
  asaasToken?: string;
  addedByUserId?: string;
};

/** Garante cadastro Movly do titular (inativo) para cartões tokenizados antes da primeira assinatura. */
export function ensureConnectMemberForPlatformUser(input: {
  userId: string;
  name: string;
  email: string;
  cpf?: string | null;
  connectPlanId?: ConnectPlanId;
  companyName?: string;
}): ConnectMemberRecord {
  const userId = input.userId.trim();
  if (!userId) {
    throw new Error('Usuário inválido.');
  }
  updateStore((s) => {
    reconcileConnectMemberForPlatformUser(s, {
      id: userId,
      name: input.name,
      email: input.email,
      cpf: input.cpf,
    });
    const byUser = findConnectMemberByUserId(s, userId);
    if (byUser) {
      if (!byUser.userId) byUser.userId = userId;
      return;
    }
    const holderName = input.name.trim() || 'Associado';
    const holderKey = normalizeHolderKey(holderName);
    const members = ensureConnectMembersArray(s);
    const byKey = members.find((m) => m.holderKey === holderKey);
    if (byKey) {
      byKey.userId = userId;
      byKey.holderCpf = input.cpf ? normalizeCpf(input.cpf) : byKey.holderCpf;
      byKey.holderEmail = input.email.trim() || byKey.holderEmail;
      return;
    }
    const now = new Date().toISOString();
    members.push({
      holderKey,
      holderName,
      connectPlanId: input.connectPlanId ?? 'connect-start',
      active: false,
      since: now,
      primaryUnitId: null,
      primaryUnitName: null,
      primaryChosenAt: null,
      primaryFirstCheckInAt: null,
      primaryCheckInsSinceFirst: 0,
      savedPaymentMethods: [],
      userId,
      holderCpf: input.cpf ? normalizeCpf(input.cpf) : undefined,
      holderEmail: input.email.trim() || undefined,
      companyName: input.companyName?.trim() || undefined,
    });
  });
  const store = loadStore();
  const member =
    findConnectMemberByUserId(store, userId) ??
    findConnectMember(store, input.name.trim());
  if (!member) {
    throw new Error('Falha ao garantir cadastro Movly.');
  }
  return member;
}

export function listConnectSavedPaymentMethodsForPlatformUser(userId: string): Array<{
  id: string;
  brand: string;
  lastFour: string;
  holderName: string;
  expiryMonth: string;
  expiryYear: string;
  isDefault: boolean;
  addedAt: string;
  usedForSubscription?: boolean;
  hasAsaasToken: boolean;
  addedByUserId?: string;
  holderKey: string;
  movlyHolderName: string;
}> {
  const id = userId.trim();
  if (!id) return [];
  const store = loadStore();
  const member = findConnectMemberByUserId(store, id);
  if (!member?.savedPaymentMethods?.length) return [];
  return member.savedPaymentMethods.map((m) => ({
    ...mapSavedPaymentMethodForClient(m),
    hasAsaasToken: Boolean(m.asaasToken?.trim()),
    holderKey: member.holderKey,
    movlyHolderName: member.holderName,
  }));
}

export function setConnectMemberAsaasCustomerId(holderName: string, asaasCustomerId: string): void {
  const trimmed = holderName.trim();
  if (!trimmed || !asaasCustomerId.trim()) return;
  const holderKey = normalizeHolderKey(trimmed);
  updateStore((s) => {
    const members = ensureConnectMembersArray(s);
    const idx = members.findIndex((m) => m.holderKey === holderKey);
    if (idx < 0) return;
    members[idx] = { ...members[idx], asaasCustomerId: asaasCustomerId.trim() };
  });
}

export function upsertConnectSavedPaymentMethod(
  input: UpsertConnectSavedPaymentMethodInput,
): ConnectMemberProfile {
  const holderName = input.holderName.trim();
  if (!holderName) {
    throw new Error('Informe o nome do titular.');
  }
  const holderKey = normalizeHolderKey(holderName);
  const now = new Date().toISOString();

  updateStore((s) => {
    const members = ensureConnectMembersArray(s);
    const idx = members.findIndex((m) => m.holderKey === holderKey);
    if (idx < 0) {
      throw new Error('Assinante não encontrado.');
    }
    const member = members[idx];
    const methods = ensureSavedPaymentMethods(member);
    const existingIdx = methods.findIndex(
      (m) => m.lastFour === input.lastFour && m.brand === input.brand,
    );

    if (input.makeDefault) {
      for (let i = 0; i < methods.length; i++) {
        methods[i] = { ...methods[i], isDefault: false };
      }
    }

    const billingLinked =
      input.usedForSubscription ??
      Boolean(input.billingCardLastFour && input.billingCardLastFour === input.lastFour);
    const addedByUserId = input.addedByUserId?.trim();
    const nextEntry: ConnectSavedPaymentMethodRecord = {
      id:
        existingIdx >= 0
          ? methods[existingIdx].id
          : `pm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      brand: input.brand,
      lastFour: input.lastFour,
      holderName: input.holderNameOnCard,
      expiryMonth: input.expiryMonth,
      expiryYear: input.expiryYear,
      isDefault: input.makeDefault || methods.length === 0,
      addedAt: existingIdx >= 0 ? methods[existingIdx].addedAt : now,
      usedForSubscription:
        billingLinked || (existingIdx >= 0 ? methods[existingIdx].usedForSubscription : false),
      asaasToken: input.asaasToken?.trim() || (existingIdx >= 0 ? methods[existingIdx].asaasToken : undefined),
      addedByUserId:
        addedByUserId ||
        (existingIdx >= 0 ? methods[existingIdx].addedByUserId : undefined) ||
        member.userId?.trim(),
    };

    if (existingIdx >= 0) {
      methods[existingIdx] = nextEntry;
    } else {
      methods.unshift(nextEntry);
    }

    if (!methods.some((m) => m.isDefault) && methods.length > 0) {
      methods[0] = { ...methods[0], isDefault: true };
    }

    if (input.billingCardLastFour) {
      member.cardLastFour = input.billingCardLastFour;
    }

    members[idx] = { ...member, savedPaymentMethods: methods };
  });

  const profile = getConnectMemberProfile(holderName);
  if (!profile) throw new Error('Falha ao salvar cartão.');
  return profile;
}

export function setConnectSavedPaymentMethodDefault(
  holderName: string,
  paymentMethodId: string,
  billingCardLastFour?: string,
  markUsedForSubscription?: boolean,
  asaasToken?: string,
): ConnectMemberProfile {
  const trimmed = holderName.trim();
  if (!trimmed) throw new Error('Informe o nome do titular.');
  const holderKey = normalizeHolderKey(trimmed);

  updateStore((s) => {
    const members = ensureConnectMembersArray(s);
    const idx = members.findIndex((m) => m.holderKey === holderKey);
    if (idx < 0) throw new Error('Assinante não encontrado.');
    const member = members[idx];
    const methods = ensureSavedPaymentMethods(member);
    const target = findConnectSavedPaymentMethod(methods, paymentMethodId);
    if (!target) throw new Error('Cartão não encontrado.');

    member.savedPaymentMethods = methods.map((m) => {
      const isTarget = m.id === target.id;
      const token = asaasToken?.trim();
      return {
        ...m,
        isDefault: isTarget,
        usedForSubscription:
          isTarget && markUsedForSubscription
            ? true
            : isTarget && billingCardLastFour && m.lastFour === billingCardLastFour
              ? true
              : m.usedForSubscription,
        asaasToken: isTarget && token ? token : m.asaasToken,
      };
    });
    if (billingCardLastFour) {
      member.cardLastFour = billingCardLastFour;
    }
    members[idx] = member;
  });

  const profile = getConnectMemberProfile(trimmed);
  if (!profile) throw new Error('Falha ao definir cartão principal.');
  return profile;
}

export function removeConnectSavedPaymentMethod(holderName: string, paymentMethodId: string): ConnectMemberProfile {
  const trimmed = holderName.trim();
  if (!trimmed) throw new Error('Informe o nome do titular.');
  const holderKey = normalizeHolderKey(trimmed);

  updateStore((s) => {
    const members = ensureConnectMembersArray(s);
    const idx = members.findIndex((m) => m.holderKey === holderKey);
    if (idx < 0) throw new Error('Assinante não encontrado.');
    const member = members[idx];
    const methods = ensureSavedPaymentMethods(member);
    const target = findConnectSavedPaymentMethod(methods, paymentMethodId);
    if (!target) throw new Error('Cartão não encontrado.');
    if (member.cardLastFour && target.lastFour === member.cardLastFour) {
      throw new Error('Não é possível remover o cartão da assinatura ativa.');
    }

    const next = methods.filter((m) => m.id !== target.id);
    if (!next.some((m) => m.isDefault) && next.length > 0) {
      next[0] = { ...next[0], isDefault: true };
    }
    member.savedPaymentMethods = next;
    members[idx] = member;
  });

  const profile = getConnectMemberProfile(trimmed);
  if (!profile) throw new Error('Falha ao remover cartão.');
  return profile;
}
