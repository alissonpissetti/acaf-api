import type {
  ApiStore,
  CheckInLogEntry,
  ConnectPlanId,
  GymStudent,
  PrimaryGymChangeRecord,
} from './types';
import { normalizeHolderKey } from './checkIn';
import { DEMO_TODAY } from './demoSeedGenerators';
import { getDomain } from './store';
import type { UnitScope } from './aggregatePayout';

export type PartnerClientRelationship = 'primary' | 'daily_pass' | 'visitor' | 'mixed';

export type PartnerClientSummary = {
  holderKey: string;
  name: string;
  email?: string;
  cpf?: string;
  companyName?: string;
  connectPlanId?: ConnectPlanId;
  isPrimaryMember: boolean;
  primaryUnitId?: string;
  primaryUnitName?: string;
  primaryChosenAt?: string;
  connectSince?: string;
  totalCheckIns: number;
  checkInsThisMonth: number;
  dailyPassesTotal: number;
  dailyPassesThisMonth: number;
  lastVisit?: string;
  relationship: PartnerClientRelationship;
  dailyPassPricePaid?: number;
  corporateBenefitPerMonth?: number;
};

export type PartnerClientCheckIn = {
  id: string;
  unitId: string;
  unitName: string;
  type: CheckInLogEntry['type'];
  validatedAt: string;
  code: string;
};

export type PartnerClientPrimaryHistory = {
  currentPrimaryUnitId?: string;
  currentPrimaryUnitName?: string;
  primaryChosenAt?: string;
  connectSince?: string;
  connectPlanId?: ConnectPlanId;
  connectPlanName?: string;
  primaryCheckInsSinceFirst?: number;
  changes: PrimaryGymChangeRecord[];
};

export type PartnerClientDetail = PartnerClientSummary & {
  checkIns: PartnerClientCheckIn[];
  primaryHistory: PartnerClientPrimaryHistory;
  studentRecords: GymStudent[];
};

type ClientAccumulator = {
  holderKey: string;
  name: string;
  email?: string;
  cpf?: string;
  companyName?: string;
  connectPlanId?: ConnectPlanId;
  isPrimaryMember: boolean;
  primaryUnitId?: string;
  primaryUnitName?: string;
  primaryChosenAt?: string;
  connectSince?: string;
  totalCheckIns: number;
  checkInsThisMonth: number;
  dailyPassesTotal: number;
  dailyPassesThisMonth: number;
  lastVisit?: string;
  hadConnectCheckIn: boolean;
  hadDailyCheckIn: boolean;
  studentIds: Set<string>;
  dailyPassPricePaid?: number;
  corporateBenefitPerMonth?: number;
};

function connectPlanLabel(planId?: ConnectPlanId): string | undefined {
  if (!planId) return undefined;
  const domain = getDomain() as { connectPlans?: Array<{ id: string; name?: string }> };
  const plan = domain.connectPlans?.find((p) => p.id === planId);
  return plan?.name ?? planId;
}

function scopedUnitIds(unitIds: string[], unitScope: UnitScope, activeUnitId: string): Set<string> {
  if (unitScope === 'single' && activeUnitId) return new Set([activeUnitId]);
  return new Set(unitIds);
}

function unitName(store: ApiStore, unitId: string): string {
  const unit = store.units.find((u) => u.id === unitId);
  if (!unit) return unitId;
  return unit.unitName?.trim() || unit.neighborhood || unitId;
}

function mergeStudentFields(acc: ClientAccumulator, student: GymStudent): void {
  if (!acc.email && student.email?.trim()) acc.email = student.email.trim();
  if (!acc.cpf && student.cpf?.trim()) acc.cpf = student.cpf.trim();
  if (!acc.companyName && student.companyName?.trim()) acc.companyName = student.companyName.trim();
  if (!acc.connectPlanId && student.connectPlanId) acc.connectPlanId = student.connectPlanId;
  if (student.dailyPassPricePaid != null) acc.dailyPassPricePaid = student.dailyPassPricePaid;
  if (student.corporateBenefitPerMonth != null) {
    acc.corporateBenefitPerMonth = student.corporateBenefitPerMonth;
  }
  if (student.name.trim().length >= acc.name.trim().length) acc.name = student.name.trim();
}

function relationshipFor(acc: ClientAccumulator): PartnerClientRelationship {
  if (acc.isPrimaryMember) {
    if (acc.hadDailyCheckIn && !acc.hadConnectCheckIn) return 'mixed';
    return 'primary';
  }
  if (acc.hadDailyCheckIn) return 'daily_pass';
  if (acc.hadConnectCheckIn) return 'visitor';
  return 'visitor';
}

function ensureClient(
  map: Map<string, ClientAccumulator>,
  holderName: string,
): ClientAccumulator {
  const holderKey = normalizeHolderKey(holderName);
  const existing = map.get(holderKey);
  if (existing) {
    if (holderName.trim().length > existing.name.trim().length) existing.name = holderName.trim();
    return existing;
  }
  const next: ClientAccumulator = {
    holderKey,
    name: holderName.trim(),
    isPrimaryMember: false,
    totalCheckIns: 0,
    checkInsThisMonth: 0,
    dailyPassesTotal: 0,
    dailyPassesThisMonth: 0,
    hadConnectCheckIn: false,
    hadDailyCheckIn: false,
    studentIds: new Set(),
  };
  map.set(holderKey, next);
  return next;
}

function recordCheckIn(
  acc: ClientAccumulator,
  entry: CheckInLogEntry,
  monthPrefix: string,
): void {
  acc.totalCheckIns += 1;
  if (entry.validatedAt.startsWith(monthPrefix)) acc.checkInsThisMonth += 1;
  if (entry.type === 'daily_pass') {
    acc.hadDailyCheckIn = true;
    acc.dailyPassesTotal += 1;
    if (entry.validatedAt.startsWith(monthPrefix)) acc.dailyPassesThisMonth += 1;
  } else {
    acc.hadConnectCheckIn = true;
  }
  if (!acc.lastVisit || entry.validatedAt > acc.lastVisit) acc.lastVisit = entry.validatedAt;
}

function toSummary(acc: ClientAccumulator): PartnerClientSummary {
  return {
    holderKey: acc.holderKey,
    name: acc.name,
    email: acc.email,
    cpf: acc.cpf,
    companyName: acc.companyName,
    connectPlanId: acc.connectPlanId,
    isPrimaryMember: acc.isPrimaryMember,
    primaryUnitId: acc.primaryUnitId,
    primaryUnitName: acc.primaryUnitName,
    primaryChosenAt: acc.primaryChosenAt,
    connectSince: acc.connectSince,
    totalCheckIns: acc.totalCheckIns,
    checkInsThisMonth: acc.checkInsThisMonth,
    dailyPassesTotal: acc.dailyPassesTotal,
    dailyPassesThisMonth: acc.dailyPassesThisMonth,
    lastVisit: acc.lastVisit,
    relationship: relationshipFor(acc),
    dailyPassPricePaid: acc.dailyPassPricePaid,
    corporateBenefitPerMonth: acc.corporateBenefitPerMonth,
  };
}

export function listPartnerClients(
  store: ApiStore,
  unitIds: string[],
  unitScope: UnitScope = 'all',
): PartnerClientSummary[] {
  const scopeUnits = scopedUnitIds(unitIds, unitScope, store.activeUnitId);
  const monthPrefix = DEMO_TODAY.slice(0, 7);
  const map = new Map<string, ClientAccumulator>();

  for (const entry of store.checkInLog) {
    if (!scopeUnits.has(entry.unitId)) continue;
    const acc = ensureClient(map, entry.holderName);
    recordCheckIn(acc, entry, monthPrefix);
  }

  for (const member of store.connectMembers ?? []) {
    if (!member.primaryUnitId || !scopeUnits.has(member.primaryUnitId)) continue;
    const acc = ensureClient(map, member.holderName);
    acc.isPrimaryMember = member.active;
    acc.primaryUnitId = member.primaryUnitId;
    acc.primaryUnitName = member.primaryUnitName ?? unitName(store, member.primaryUnitId);
    acc.primaryChosenAt = member.primaryChosenAt ?? undefined;
    acc.connectSince = member.since;
    acc.connectPlanId = member.connectPlanId;
    if (member.companyName?.trim()) acc.companyName = member.companyName.trim();
    if (member.holderName.trim().length >= acc.name.trim().length) acc.name = member.holderName.trim();
  }

  for (const student of store.students) {
    if (!scopeUnits.has(student.unitId)) continue;
    const acc = ensureClient(map, student.name);
    mergeStudentFields(acc, student);
    acc.studentIds.add(student.id);
  }

  return [...map.values()]
    .map(toSummary)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
}

export function getPartnerClientDetail(
  store: ApiStore,
  unitIds: string[],
  holderKey: string,
  unitScope: UnitScope = 'all',
): PartnerClientDetail | null {
  const key = normalizeHolderKey(holderKey);
  const scopeUnits = scopedUnitIds(unitIds, unitScope, store.activeUnitId);
  const summaries = listPartnerClients(store, unitIds, unitScope);
  const summary = summaries.find((c) => c.holderKey === key);
  if (!summary) return null;

  const member = store.connectMembers?.find((m) => m.holderKey === key);
  const changes = (store.primaryGymChanges ?? [])
    .filter((c) => c.holderKey === key)
    .sort((a, b) => b.changedAt.localeCompare(a.changedAt));

  const checkIns: PartnerClientCheckIn[] = store.checkInLog
    .filter((e) => scopeUnits.has(e.unitId) && normalizeHolderKey(e.holderName) === key)
    .sort((a, b) => b.validatedAt.localeCompare(a.validatedAt))
    .map((e) => ({
      id: e.id,
      unitId: e.unitId,
      unitName: unitName(store, e.unitId),
      type: e.type,
      validatedAt: e.validatedAt,
      code: e.code,
    }));

  const studentRecords = store.students.filter(
    (s) => scopeUnits.has(s.unitId) && normalizeHolderKey(s.name) === key,
  );

  const planName = connectPlanLabel(member?.connectPlanId ?? summary.connectPlanId);

  const primaryHistory: PartnerClientPrimaryHistory = {
    currentPrimaryUnitId: member?.primaryUnitId ?? undefined,
    currentPrimaryUnitName:
      member?.primaryUnitName ??
      (member?.primaryUnitId ? unitName(store, member.primaryUnitId) : undefined),
    primaryChosenAt: member?.primaryChosenAt ?? undefined,
    connectSince: member?.since ?? undefined,
    connectPlanId: member?.connectPlanId ?? summary.connectPlanId,
    connectPlanName: planName,
    primaryCheckInsSinceFirst: member?.primaryCheckInsSinceFirst,
    changes: changes.filter(
      (c) => scopeUnits.has(c.toUnitId) || (c.fromUnitId != null && scopeUnits.has(c.fromUnitId)),
    ),
  };

  return {
    ...summary,
    checkIns,
    primaryHistory,
    studentRecords,
  };
}
