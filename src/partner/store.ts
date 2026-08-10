import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInitialStore, type ApiStore, type GymUnit } from './types';
import { dedupeCheckInLogByPersonPerDay } from './checkIn';
import { buildPayoutHistoryByUnit, buildCurrentPayoutsByUnit, demoPendingCheckIns } from './demoSeed';
import {
  normalizeModalitySlotOverrides,
  normalizeModalitySlotTemplates,
} from './modalitySchedule';
import { mergePlanSpecsWithDomain } from './planSpecs';
import {
  formatOpenHoursSummary,
  normalizeWeeklySchedule,
} from './weeklySchedule';
import { normalizeDailyPassPricingRules } from './dailyPassPricing';
import { clampCheckInsThisMonth, MAX_DAILY_PASSES_PER_MONTH } from './studentLimits';
import { applyStudentStatsFromLog, DEMO_TODAY } from './demoSeedGenerators';
import { normalizeRealisticGymCheckInTimes } from './gymLocalTime';
import { withDemoCorporateFields } from '../corporate/demo-corporate-companies';

const STORE_PATH = join(process.cwd(), 'data', 'store.json');
const DOMAIN_PATH = join(process.cwd(), 'shared', 'connect_domain.json');

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

function normalizeStore(store: ApiStore): ApiStore {
  store.units = store.units.map(normalizeUnit);
  store.students = store.students.map((s) => {
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
    if (!next.companyName) {
      next = withDemoCorporateFields(next);
    }
    return next;
  });
  store.checkInLog = dedupeCheckInLogByPersonPerDay(
    normalizeRealisticGymCheckInTimes(
      store.checkInLog.map((entry) => {
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
    store.pendingCheckIns = demoPendingCheckIns().filter((p) =>
      store.units.some((u) => u.id === p.unitId),
    );
  }
  if (!store.payoutHistoryByUnit || Object.keys(store.payoutHistoryByUnit).length === 0) {
    store.payoutHistoryByUnit = buildPayoutHistoryByUnit();
    store.payoutsByUnit = buildCurrentPayoutsByUnit(store.payoutHistoryByUnit);
  }
  if (!store.networks?.length) {
    store.networks = [{ id: store.networkId, name: store.networkName }];
  }
  for (const unit of store.units) {
    if (!unit.networkId) {
      unit.networkId = store.networkId;
    }
  }
  for (const unit of store.units) {
    if (!store.payoutsByUnit[unit.id]) {
      const hist = store.payoutHistoryByUnit[unit.id];
      if (hist?.length) store.payoutsByUnit[unit.id] = hist[hist.length - 1]!;
    }
    if (!store.payoutHistoryByUnit[unit.id]) {
      store.payoutHistoryByUnit[unit.id] = [store.payoutsByUnit[unit.id]].filter(Boolean) as ApiStore['payoutHistoryByUnit'][string];
    }
  }
  store.students = applyStudentStatsFromLog(
    store.students,
    store.checkInLog,
    DEMO_TODAY.slice(0, 7),
  );
  if (!Array.isArray(store.connectMembers)) {
    store.connectMembers = [];
  }
  if (!Array.isArray(store.primaryGymChanges)) {
    store.primaryGymChanges = [];
  }
  return store;
}

export function getDomain() {
  return JSON.parse(readFileSync(DOMAIN_PATH, 'utf-8'));
}

let cache: ApiStore | null = null;
let cacheMtime = 0;

export function loadStore(): ApiStore {
  if (existsSync(STORE_PATH)) {
    const mtime = statSync(STORE_PATH).mtimeMs;
    if (cache && mtime === cacheMtime) return cache;
    const raw = readFileSync(STORE_PATH, 'utf-8');
    const rawStore = JSON.parse(raw) as ApiStore;
    const before = rawStore.checkInLog?.length ?? 0;
    const normalized = normalizeStore(rawStore);
    const rawTimes = new Map(rawStore.checkInLog?.map((e) => [e.id, e.validatedAt]) ?? []);
    const timesChanged = normalized.checkInLog.some(
      (e) => rawTimes.get(e.id) !== e.validatedAt,
    );
    if (normalized.checkInLog.length < before || timesChanged) {
      saveStore(normalized);
      return normalized;
    }
    cache = normalized;
    cacheMtime = mtime;
    return cache;
  }
  if (cache) return cache;
  cache = createInitialStore();
  saveStore(cache);
  return cache;
}

export function saveStore(store: ApiStore) {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  cache = store;
  cacheMtime = existsSync(STORE_PATH) ? statSync(STORE_PATH).mtimeMs : 0;
}

export function saveDomain(domain: Record<string, unknown>) {
  writeFileSync(DOMAIN_PATH, JSON.stringify(domain, null, 2), 'utf-8');
}

export function updateStore(mutator: (draft: ApiStore) => void): ApiStore {
  const store = structuredClone(loadStore());
  mutator(store);
  saveStore(store);
  return store;
}
