import type { ApiStore } from './types';
import { normalizeHolderKey } from './checkIn';
import { brDateKeyFromIso, brDateKeyToday } from './gymLocalTime';

function currentMonthPrefixBr(): string {
  return brDateKeyToday().slice(0, 7);
}

/** Tipos de check-in que representam plano Movly (inclui legado do store). */
function isConnectPlanCheckInType(type: string | undefined): boolean {
  const t = String(type ?? '');
  return t === 'connect_member' || t === 'connect_visitor';
}

/** Data do check-in no fuso Brasil, alinhada ao mês civil de vidas pagantes. */
function checkInValidatedInMonth(validatedAt: string, monthPrefix: string): boolean {
  const raw = String(validatedAt ?? '').trim();
  if (!raw) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw.slice(0, 7) === monthPrefix;
  }
  return brDateKeyFromIso(raw).startsWith(monthPrefix);
}

function unitAllowed(unitIds: Set<string> | undefined, unitId: string): boolean {
  return !unitIds || unitIds.has(unitId);
}

/**
 * Titulares únicos com check-in de plano no mês (confirmado no log ou pendente na recepção).
 * Esta é a definição de vida pagante: sem check-in no mês, não há mensalidade da empresa naquele período.
 */
function collectCheckInHolderKeysThisMonth(
  store: ApiStore,
  monthPrefix: string,
  keys: Set<string>,
  unitIds?: Set<string>,
): void {
  for (const entry of store.checkInLog ?? []) {
    if (!isConnectPlanCheckInType(entry.type)) continue;
    if (!unitAllowed(unitIds, entry.unitId)) continue;
    if (!checkInValidatedInMonth(entry.validatedAt, monthPrefix)) continue;
    const key = normalizeHolderKey(entry.holderName);
    if (key) keys.add(key);
  }
  for (const pending of store.pendingCheckIns ?? []) {
    if (pending.status !== 'pending') continue;
    if (!isConnectPlanCheckInType(pending.type)) continue;
    if (!unitAllowed(unitIds, pending.unitId)) continue;
    if (!checkInValidatedInMonth(pending.requestedAt, monthPrefix)) continue;
    const key = normalizeHolderKey(pending.holderName);
    if (key) keys.add(key);
  }
}

function payingLifeHolderKeys(
  store: ApiStore,
  unitIds?: Set<string>,
  monthPrefix = currentMonthPrefixBr(),
): Set<string> {
  const keys = new Set<string>();
  collectCheckInHolderKeysThisMonth(store, monthPrefix, keys, unitIds);
  return keys;
}

export function currentAssociatePayingLivesMonthPrefix(): string {
  return currentMonthPrefixBr();
}

/** Titulares únicos com check-in de plano no mês civil (confirmado ou pendente). */
export function countCheckInPayingHoldersThisMonth(
  store: ApiStore,
  unitIds?: Set<string>,
  monthPrefix = currentMonthPrefixBr(),
): number {
  return payingLifeHolderKeys(store, unitIds, monthPrefix).size;
}

/** Quantidade de check-ins de plano confirmados no log no mês (pode ser > titulares únicos). */
export function countCheckInEventsThisMonth(
  store: ApiStore,
  unitIds?: Set<string>,
  monthPrefix = currentMonthPrefixBr(),
): number {
  let count = 0;
  for (const entry of store.checkInLog ?? []) {
    if (!isConnectPlanCheckInType(entry.type)) continue;
    if (!unitAllowed(unitIds, entry.unitId)) continue;
    if (!checkInValidatedInMonth(entry.validatedAt, monthPrefix)) continue;
    count += 1;
  }
  return count;
}

/**
 * Vidas pagantes no escopo de unidades (portal da associação).
 * Somente check-ins de plano nas unidades informadas.
 */
export function countAssociatePayingLivesForUnits(store: ApiStore, unitIds: Set<string>): number {
  if (!unitIds.size) return 0;
  return payingLifeHolderKeys(store, unitIds).size;
}

export type PlanCheckInLogSummary = {
  validatedAt: string;
  type: string;
  holderName: string;
  unitId: string;
};

export type PayingLivesDiagnostics = {
  /** Titulares únicos com check-in de plano no mês — igual ao KPI de vidas pagantes. */
  count: number;
  monthPrefix: string;
  checkInHoldersThisMonth: number;
  checkInEventsThisMonth: number;
  pendingHoldersThisMonth: number;
  connectMembersTotal: number;
  /** Entradas totais no log (qualquer tipo) — útil para suporte. */
  checkInLogTotal: number;
  /** Último check-in de plano no log (independente do mês). */
  lastPlanCheckIn: PlanCheckInLogSummary | null;
};

function countPendingHoldersThisMonth(
  store: ApiStore,
  unitIds?: Set<string>,
  monthPrefix = currentMonthPrefixBr(),
): number {
  const keys = new Set<string>();
  for (const pending of store.pendingCheckIns ?? []) {
    if (pending.status !== 'pending') continue;
    if (!isConnectPlanCheckInType(pending.type)) continue;
    if (!unitAllowed(unitIds, pending.unitId)) continue;
    if (!checkInValidatedInMonth(pending.requestedAt, monthPrefix)) continue;
    const key = normalizeHolderKey(pending.holderName);
    if (key) keys.add(key);
  }
  return keys.size;
}

function lastPlanCheckInInLog(store: ApiStore): PlanCheckInLogSummary | null {
  let best: PlanCheckInLogSummary | null = null;
  for (const entry of store.checkInLog ?? []) {
    if (!isConnectPlanCheckInType(entry.type)) continue;
    const row: PlanCheckInLogSummary = {
      validatedAt: entry.validatedAt,
      type: String(entry.type ?? ''),
      holderName: entry.holderName,
      unitId: entry.unitId,
    };
    if (!best || String(entry.validatedAt).localeCompare(best.validatedAt) > 0) {
      best = row;
    }
  }
  return best;
}

export function diagnoseAssociatePayingLives(store: ApiStore): PayingLivesDiagnostics {
  const monthPrefix = currentMonthPrefixBr();
  const holders = countCheckInPayingHoldersThisMonth(store);
  return {
    count: holders,
    monthPrefix,
    checkInHoldersThisMonth: holders,
    checkInEventsThisMonth: countCheckInEventsThisMonth(store),
    pendingHoldersThisMonth: countPendingHoldersThisMonth(store),
    connectMembersTotal: store.connectMembers?.length ?? 0,
    checkInLogTotal: store.checkInLog?.length ?? 0,
    lastPlanCheckIn: lastPlanCheckInInLog(store),
  };
}

/**
 * Vidas pagantes para faixas de repasse e evolução mensal: titulares únicos com
 * pelo menos um check-in de plano Movly no mês civil (America/Sao_Paulo) — confirmado
 * ou ainda pendente na recepção. Assinatura sem check-in no mês não conta.
 */
export function countAssociatePayingLives(store: ApiStore): number {
  return payingLifeHolderKeys(store).size;
}