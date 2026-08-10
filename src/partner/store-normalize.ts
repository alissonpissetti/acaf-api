import { dedupeCheckInLogByPersonPerDay, normalizeHolderKey } from './checkIn';
import { mergePlanSpecsWithDomain } from './planSpecs';
import {
  normalizeModalitySlotOverrides,
  normalizeModalitySlotTemplates,
} from './modalitySchedule';
import {
  formatOpenHoursSummary,
  normalizeWeeklySchedule,
} from './weeklySchedule';
import { normalizeDailyPassPricingRules } from './dailyPassPricing';
import { clampCheckInsThisMonth, MAX_DAILY_PASSES_PER_MONTH } from './studentLimits';
import { normalizeRealisticGymCheckInTimes } from './gymLocalTime';
import type { ApiStore, GymUnit } from './types';

const CORPORATE_BENEFIT_PER_MONTH = 44.9;

function roundDailyStudentPrice(price: number): number {
  if (!Number.isFinite(price) || price < 0) return 0;
  return Math.round(price * 100) / 100;
}

function normalizeUnit(unit: GymUnit): GymUnit {
  const dailyPassModalities =
    unit.dailyPassModalities && unit.dailyPassModalities.length > 0
      ? unit.dailyPassModalities.filter((m) => unit.modalities.includes(m))
      : [...unit.modalities];
  const planSpecs = mergePlanSpecsWithDomain(unit.planSpecs).map((spec) => ({
    ...spec,
    includedModalities: spec.includedModalities.filter((m) =>
      unit.modalities.some((u) => u.toLowerCase() === m.toLowerCase()),
    ),
  }));
  return {
    ...unit,
    dailyPassModalities,
    planSpecs,
    autoApproveCheckIn: unit.autoApproveCheckIn ?? true,
    dailyPassPrice: roundDailyStudentPrice(unit.dailyPassPrice),
    modalitySlotTemplates: normalizeModalitySlotTemplates(unit, unit.modalitySlotTemplates),
    modalitySlotOverrides: normalizeModalitySlotOverrides(unit, unit.modalitySlotOverrides),
    weeklySchedule: unit.weeklySchedule ? normalizeWeeklySchedule(unit.weeklySchedule) : undefined,
    openHours: unit.weeklySchedule
      ? formatOpenHoursSummary(normalizeWeeklySchedule(unit.weeklySchedule))
      : unit.openHours,
    dailyPassPricingRules: normalizeDailyPassPricingRules(unit, unit.dailyPassPricingRules),
  };
}

/** Store vazio — sem dados demo. */
export function createEmptyStore(): ApiStore {
  return {
    networkId: '',
    networkName: '',
    networks: [],
    activeUnitId: '',
    units: [],
    students: [],
    payoutsByUnit: {},
    payoutHistoryByUnit: {},
    issuedCodes: [],
    checkInLog: [],
    pendingCheckIns: [],
    modalityReservations: [],
    connectMembers: [],
    primaryGymChanges: [],
  };
}

/** Normaliza estruturas sem injetar seed demo. */
export function normalizeStoreSnapshot(store: ApiStore): ApiStore {
  store.units = (store.units ?? []).map(normalizeUnit);
  store.networks = store.networks ?? [];
  store.students = (store.students ?? []).map((s) => {
    let next = s;
    const channel =
      (s as { channel: string }).channel === 'connect_visitor' ? 'connect_primary' : s.channel;
    if (channel !== s.channel) {
      next = { ...next, channel: 'connect_primary' };
    }
    if (channel === 'connect_primary') {
      next = { ...next, corporateBenefitPerMonth: CORPORATE_BENEFIT_PER_MONTH };
    }
    if (s.channel === 'daily_pass') {
      const unit = store.units.find((u) => u.id === s.unitId);
      const paid = roundDailyStudentPrice(s.dailyPassPricePaid ?? unit?.dailyPassPrice ?? 39.9);
      next = {
        ...next,
        dailyPassPricePaid: paid,
        dailyPassesThisMonth: Math.min(MAX_DAILY_PASSES_PER_MONTH, next.dailyPassesThisMonth ?? 0),
      };
    }
    next = {
      ...next,
      checkInsThisMonth: clampCheckInsThisMonth(next.checkInsThisMonth),
    };
    return next;
  });

  store.checkInLog = dedupeCheckInLogByPersonPerDay(
    normalizeRealisticGymCheckInTimes(
      (store.checkInLog ?? []).map((entry) => {
        const legacyType = entry.type as string;
        return legacyType === 'connect_visitor' ? { ...entry, type: 'connect_member' as const } : entry;
      }),
    ),
    store.units,
  );

  if (!Array.isArray(store.modalityReservations)) {
    store.modalityReservations = [];
  }
  if (!Array.isArray(store.pendingCheckIns)) {
    store.pendingCheckIns = [];
  }
  if (!store.payoutHistoryByUnit) {
    store.payoutHistoryByUnit = {};
  }
  if (!store.payoutsByUnit) {
    store.payoutsByUnit = {};
  }

  if (!store.networks.length && store.networkId) {
    store.networks = [{ id: store.networkId, name: store.networkName || store.networkId }];
  }

  for (const unit of store.units) {
    if (!unit.networkId && store.networkId) {
      unit.networkId = store.networkId;
    }
  }

  if (!Array.isArray(store.connectMembers)) {
    store.connectMembers = [];
  }
  if (!Array.isArray(store.primaryGymChanges)) {
    store.primaryGymChanges = [];
  }

  backfillStudentCompanies(store);

  return store;
}

function backfillStudentCompanies(store: ApiStore): void {
  for (const student of store.students) {
    if (student.companyName?.trim()) continue;
    const holderKey = normalizeHolderKey(student.name);
    for (const member of store.connectMembers ?? []) {
      if (member.holderKey === holderKey && member.companyName?.trim()) {
        student.companyName = member.companyName.trim();
        break;
      }
    }
    if (student.companyName?.trim()) continue;
    for (const other of store.students) {
      if (normalizeHolderKey(other.name) !== holderKey) continue;
      if (!other.companyName?.trim()) continue;
      student.companyName = other.companyName.trim();
      if (!student.companySlug && other.companySlug) student.companySlug = other.companySlug;
      break;
    }
  }
}
