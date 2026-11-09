import type { AcafRepasseTier } from './acafRepassePolicy';
import { ACAF_REPASSE_TIERS, resolveAcafRepasseTier } from './acafRepassePolicy';
import type { ApiStore, AssociateRepasseDailySnapshot, AssociateRepasseEffectiveState } from './types';
import { countAssociatePayingLives } from './associatePayingLives';

/** Fuso usado para “dia” operacional (Brasil). */
export const ASSOCIATE_REPASSE_TIMEZONE = 'America/Sao_Paulo';

/** Dias corridos na faixa para **aumentar** o % de repasse (faixa melhor para a academia). */
export const DAYS_TO_IMPROVE_REPASSE = 90;

/** Dias corridos na faixa para **reduzir** o % de repasse (faixa pior). */
export const DAYS_TO_REDUCE_REPASSE = 30;

/**
 * Churn líquido máximo permitido no mês civil **anterior** à transição de faixa de repasse (%).
 * Fórmula: max(0, (vidas no 1º dia − vidas no último dia) / vidas no 1º dia) × 100.
 */
export const MAX_NET_CHURN_PERCENT_MONTHLY = 3;

export function formatDateYyyyMmDdInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function tierById(id: string): AcafRepasseTier | undefined {
  return ACAF_REPASSE_TIERS.find((t) => t.id === id);
}

function compareSnapshotDate(a: string, b: string): number {
  return a.localeCompare(b);
}

/** YYYY-MM-DD → { y, m, d } em componentes civis da string (não UTC). */
function parseYyyyMmDdParts(isoDate: string): { y: number; m: number; d: number } | null {
  const m = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function monthKey(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, '0')}`;
}

function previousCalendarMonth(y: number, m: number): { y: number; m: number } {
  if (m <= 1) return { y: y - 1, m: 12 };
  return { y, m: m - 1 };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export type NetChurnMonthResult = {
  /** Churn líquido % no mês de referência, ou null se dados insuficientes */
  netChurnPercent: number | null;
  /** Mês avaliado (anterior ao mês da data de referência), ex. "2026-02" */
  referenceMonthKey: string;
  startCount: number | null;
  endCount: number | null;
  startDate: string | null;
  endDate: string | null;
  insufficientData: boolean;
};

/**
 * Mês civil completo **anterior** ao mês da `referenceDateStr` (YYYY-MM-DD).
 * Churn líquido = queda líquida de vidas do primeiro ao último dia útil com snapshot.
 */
export function netChurnPercentForMonthBeforeTransitionDate(
  sortedSnapshots: AssociateRepasseDailySnapshot[],
  referenceDateStr: string,
): NetChurnMonthResult {
  const invalid: NetChurnMonthResult = {
    netChurnPercent: null,
    referenceMonthKey: '',
    startCount: null,
    endCount: null,
    startDate: null,
    endDate: null,
    insufficientData: true,
  };

  const ref = parseYyyyMmDdParts(referenceDateStr);
  if (!ref) return invalid;

  const prev = previousCalendarMonth(ref.y, ref.m);
  const y = prev.y;
  const month = prev.m;
  const refKey = monthKey(y, month);
  const dim = daysInMonth(y, month);
  const firstDay = `${y}-${String(month).padStart(2, '0')}-01`;
  const lastDay = `${y}-${String(month).padStart(2, '0')}-${String(dim).padStart(2, '0')}`;

  if (!sortedSnapshots.length) {
    return {
      ...invalid,
      referenceMonthKey: refKey,
    };
  }

  const inMonth = sortedSnapshots.filter((s) => s.date >= firstDay && s.date <= lastDay);
  if (!inMonth.length) {
    return {
      ...invalid,
      referenceMonthKey: refKey,
    };
  }

  const firstSnap = inMonth.find((s) => s.date >= firstDay) ?? inMonth[0];
  const lastSnap = [...inMonth].reverse().find((s) => s.date <= lastDay) ?? inMonth[inMonth.length - 1];

  if (!firstSnap || !lastSnap || firstSnap.date > lastDay || lastSnap.date < firstDay) {
    return {
      ...invalid,
      referenceMonthKey: refKey,
    };
  }

  const start = firstSnap.payingLivesCount;
  const end = lastSnap.payingLivesCount;
  if (start < 0 || end < 0) {
    return {
      ...invalid,
      referenceMonthKey: refKey,
    };
  }

  if (start === 0) {
    return {
      netChurnPercent: 0,
      referenceMonthKey: refKey,
      startCount: start,
      endCount: end,
      startDate: firstSnap.date,
      endDate: lastSnap.date,
      insufficientData: false,
    };
  }

  const raw = ((start - end) / start) * 100;
  const netChurnPercent = Math.max(0, Math.round(raw * 100) / 100);

  return {
    netChurnPercent,
    referenceMonthKey: refKey,
    startCount: start,
    endCount: end,
    startDate: firstSnap.date,
    endDate: lastSnap.date,
    insufficientData: false,
  };
}

/** Mantém ordenado por data e remove duplicatas (mantém o último). */
export function normalizeAssociateRepasseSnapshots(
  rows: AssociateRepasseDailySnapshot[] | undefined,
): AssociateRepasseDailySnapshot[] {
  if (!Array.isArray(rows) || !rows.length) return [];
  const byDate = new Map<string, AssociateRepasseDailySnapshot>();
  for (const row of rows) {
    if (!row?.date) continue;
    byDate.set(row.date, row);
  }
  return [...byDate.values()].sort((x, y) => compareSnapshotDate(x.date, y.date));
}

const MAX_SNAPSHOTS = 450;

export function capAssociateRepasseSnapshots(rows: AssociateRepasseDailySnapshot[]): AssociateRepasseDailySnapshot[] {
  const sorted = normalizeAssociateRepasseSnapshots(rows);
  if (sorted.length <= MAX_SNAPSHOTS) return sorted;
  return sorted.slice(sorted.length - MAX_SNAPSHOTS);
}

/** Dias consecutivos (mesma faixa instantânea) terminando no índice `endIdx`. */
export function consecutiveInstantaneousTierDaysEndingAt(
  sorted: AssociateRepasseDailySnapshot[],
  endIdx: number,
  tierId: string,
): number {
  let n = 0;
  for (let i = endIdx; i >= 0; i--) {
    if (sorted[i].instantaneousTierId !== tierId) break;
    n++;
  }
  return n;
}

/**
 * Reaplica a regra de permanência sobre o histórico ordenado por data:
 * — subir repasse: 90 dias corridos na faixa de destino;
 * — baixar repasse: 30 dias corridos na faixa de destino;
 * — churn líquido do mês civil anterior ≤ 3% (caso contrário a mudança de faixa fica pendente).
 */
export function recomputeAssociateRepasseEffective(
  rows: AssociateRepasseDailySnapshot[],
  nowIso = new Date().toISOString(),
): AssociateRepasseEffectiveState | null {
  const sorted = normalizeAssociateRepasseSnapshots(rows);
  if (!sorted.length) return null;

  const first = sorted[0];
  let eff: AssociateRepasseEffectiveState = {
    tierId: first.instantaneousTierId,
    repassePercent: first.instantaneousRepassePercent,
    sinceDate: first.date,
    updatedAt: nowIso,
  };

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const instPct = cur.instantaneousRepassePercent;
    if (instPct === eff.repassePercent) continue;

    const streak = consecutiveInstantaneousTierDaysEndingAt(sorted, i, cur.instantaneousTierId);
    const minDays = instPct > eff.repassePercent ? DAYS_TO_IMPROVE_REPASSE : DAYS_TO_REDUCE_REPASSE;
    if (streak < minDays) continue;

    const churn = netChurnPercentForMonthBeforeTransitionDate(sorted, cur.date);
    if (
      !churn.insufficientData &&
      churn.netChurnPercent != null &&
      churn.netChurnPercent > MAX_NET_CHURN_PERCENT_MONTHLY
    ) {
      continue;
    }

    const startIdx = i - streak + 1;
    eff = {
      tierId: cur.instantaneousTierId,
      repassePercent: instPct,
      sinceDate: sorted[startIdx].date,
      updatedAt: nowIso,
    };
  }

  return eff;
}

export function buildDailySnapshot(
  payingLivesCount: number,
  dateStr: string,
): AssociateRepasseDailySnapshot {
  const tier = resolveAcafRepasseTier(payingLivesCount);
  return {
    date: dateStr,
    payingLivesCount,
    instantaneousTierId: tier.id,
    instantaneousRepassePercent: tier.repassePercent,
  };
}

/** Garante estado inicial quando ainda não há job diário. */
export function defaultEffectiveFromInstant(
  payingLivesCount: number,
  dateStr: string,
  nowIso: string,
): AssociateRepasseEffectiveState {
  const tier = resolveAcafRepasseTier(payingLivesCount);
  return {
    tierId: tier.id,
    repassePercent: tier.repassePercent,
    sinceDate: dateStr,
    updatedAt: nowIso,
  };
}

export function tierLabelForId(tierId: string): string | undefined {
  const t = tierById(tierId);
  return t ? `${t.repassePercent}%` : undefined;
}

const TIERS_BY_REPASSE_DESC = [...ACAF_REPASSE_TIERS].sort((a, b) => b.repassePercent - a.repassePercent);

export function nextBetterTierId(currentTierId: string): string | null {
  const idx = TIERS_BY_REPASSE_DESC.findIndex((t) => t.id === currentTierId);
  if (idx <= 0) return null;
  return TIERS_BY_REPASSE_DESC[idx - 1].id;
}

export function nextWorseTierId(currentTierId: string): string | null {
  const idx = TIERS_BY_REPASSE_DESC.findIndex((t) => t.id === currentTierId);
  if (idx < 0 || idx >= TIERS_BY_REPASSE_DESC.length - 1) return null;
  return TIERS_BY_REPASSE_DESC[idx + 1].id;
}

export type TierPersistenceProgress = {
  targetTierId: string;
  targetRepassePercent: number;
  requiredConsecutiveDays: number;
  consecutiveDays: number;
  daysRemaining: number;
  blockedByNetChurn: boolean;
  netChurnPercent: number | null;
  churnReferenceMonthKey: string | null;
  maxNetChurnPercentAllowed: number;
};

export function computeTierPersistenceProgress(
  sortedSnapshots: AssociateRepasseDailySnapshot[],
  effectiveTierId: string,
): { upgrade: TierPersistenceProgress | null; downgrade: TierPersistenceProgress | null } {
  if (!sortedSnapshots.length) {
    return { upgrade: null, downgrade: null };
  }
  const endIdx = sortedSnapshots.length - 1;
  const endDate = sortedSnapshots[endIdx].date;
  const upgradeId = nextBetterTierId(effectiveTierId);
  const downgradeId = nextWorseTierId(effectiveTierId);

  let upgrade: TierPersistenceProgress | null = null;
  if (upgradeId) {
    const tier = tierById(upgradeId)!;
    const streak = consecutiveInstantaneousTierDaysEndingAt(sortedSnapshots, endIdx, upgradeId);
    const req = DAYS_TO_IMPROVE_REPASSE;
    const churn = netChurnPercentForMonthBeforeTransitionDate(sortedSnapshots, endDate);
    const blocked =
      !churn.insufficientData &&
      churn.netChurnPercent != null &&
      churn.netChurnPercent > MAX_NET_CHURN_PERCENT_MONTHLY;
    upgrade = {
      targetTierId: upgradeId,
      targetRepassePercent: tier.repassePercent,
      requiredConsecutiveDays: req,
      consecutiveDays: streak,
      daysRemaining: Math.max(0, req - streak),
      blockedByNetChurn: blocked,
      netChurnPercent: churn.netChurnPercent,
      churnReferenceMonthKey: churn.referenceMonthKey || null,
      maxNetChurnPercentAllowed: MAX_NET_CHURN_PERCENT_MONTHLY,
    };
  }

  let downgrade: TierPersistenceProgress | null = null;
  if (downgradeId) {
    const tier = tierById(downgradeId)!;
    const streak = consecutiveInstantaneousTierDaysEndingAt(sortedSnapshots, endIdx, downgradeId);
    const req = DAYS_TO_REDUCE_REPASSE;
    const churn = netChurnPercentForMonthBeforeTransitionDate(sortedSnapshots, endDate);
    const blocked =
      !churn.insufficientData &&
      churn.netChurnPercent != null &&
      churn.netChurnPercent > MAX_NET_CHURN_PERCENT_MONTHLY;
    downgrade = {
      targetTierId: downgradeId,
      targetRepassePercent: tier.repassePercent,
      requiredConsecutiveDays: req,
      consecutiveDays: streak,
      daysRemaining: Math.max(0, req - streak),
      blockedByNetChurn: blocked,
      netChurnPercent: churn.netChurnPercent,
      churnReferenceMonthKey: churn.referenceMonthKey || null,
      maxNetChurnPercentAllowed: MAX_NET_CHURN_PERCENT_MONTHLY,
    };
  }

  return { upgrade, downgrade };
}

export type AssociateRepasseOverview = {
  payingLivesCount: number;
  instantaneousTierId: string;
  instantaneousRepassePercent: number;
  effectiveTierId: string;
  effectiveRepassePercent: number;
  effectiveSinceDate: string;
  effectiveUpdatedAt: string;
  upgradeProgress: TierPersistenceProgress | null;
  downgradeProgress: TierPersistenceProgress | null;
  lastSnapshotDate: string | null;
  netChurnRolling: NetChurnMonthResult;
};

export function getAssociateRepasseOverview(store: ApiStore, now = new Date()): AssociateRepasseOverview {
  const payingLivesCount = countAssociatePayingLives(store);
  const inst = resolveAcafRepasseTier(payingLivesCount);
  const rows = normalizeAssociateRepasseSnapshots(store.associateRepasseSnapshots);

  let effective: AssociateRepasseEffectiveState | null = null;
  if (rows.length) {
    effective = recomputeAssociateRepasseEffective(rows, now.toISOString());
  } else {
    effective = store.associateRepasseEffective ?? null;
  }

  if (!effective) {
    const dateStr = formatDateYyyyMmDdInTimeZone(now, ASSOCIATE_REPASSE_TIMEZONE);
    effective = defaultEffectiveFromInstant(payingLivesCount, dateStr, now.toISOString());
  }

  const progress = computeTierPersistenceProgress(rows, effective.tierId);
  const lastSnapshotDate = rows.length ? rows[rows.length - 1].date : null;
  const netChurnRolling = lastSnapshotDate
    ? netChurnPercentForMonthBeforeTransitionDate(rows, lastSnapshotDate)
    : {
        netChurnPercent: null,
        referenceMonthKey: '',
        startCount: null,
        endCount: null,
        startDate: null,
        endDate: null,
        insufficientData: true,
      };

  return {
    payingLivesCount,
    instantaneousTierId: inst.id,
    instantaneousRepassePercent: inst.repassePercent,
    effectiveTierId: effective.tierId,
    effectiveRepassePercent: effective.repassePercent,
    effectiveSinceDate: effective.sinceDate,
    effectiveUpdatedAt: effective.updatedAt,
    upgradeProgress: progress.upgrade,
    downgradeProgress: progress.downgrade,
    lastSnapshotDate,
    netChurnRolling,
  };
}

/**
 * Sincroniza histórico do dia e estado efetivo (reprocessamento se o código ou dados divergirem).
 * @returns true se houve alteração persistível no store.
 */
export function syncAssociateRepasseState(store: ApiStore, now = new Date()): boolean {
  const dateStr = formatDateYyyyMmDdInTimeZone(now, ASSOCIATE_REPASSE_TIMEZONE);
  const rows = normalizeAssociateRepasseSnapshots(store.associateRepasseSnapshots);

  if (!rows.some((r) => r.date === dateStr)) {
    return recordAssociateRepasseDailySnapshotIfNeeded(store, now);
  }

  const replayed =
    recomputeAssociateRepasseEffective(rows, now.toISOString()) ??
    defaultEffectiveFromInstant(countAssociatePayingLives(store), dateStr, now.toISOString());

  const cur = store.associateRepasseEffective;
  if (
    !cur ||
    cur.tierId !== replayed.tierId ||
    cur.repassePercent !== replayed.repassePercent ||
    cur.sinceDate !== replayed.sinceDate
  ) {
    store.associateRepasseEffective = replayed;
    return true;
  }
  return false;
}

/**
 * @returns true se criou snapshot do dia (deve persistir).
 */
export function recordAssociateRepasseDailySnapshotIfNeeded(
  store: ApiStore,
  now = new Date(),
): boolean {
  const dateStr = formatDateYyyyMmDdInTimeZone(now, ASSOCIATE_REPASSE_TIMEZONE);
  const rows = normalizeAssociateRepasseSnapshots(store.associateRepasseSnapshots);
  if (rows.some((r) => r.date === dateStr)) return false;

  const payingLivesCount = countAssociatePayingLives(store);
  const snap = buildDailySnapshot(payingLivesCount, dateStr);
  const merged = capAssociateRepasseSnapshots([...rows, snap]);
  store.associateRepasseSnapshots = merged;

  const eff = recomputeAssociateRepasseEffective(merged, now.toISOString());
  if (eff) {
    store.associateRepasseEffective = eff;
  } else {
    store.associateRepasseEffective = defaultEffectiveFromInstant(
      payingLivesCount,
      dateStr,
      now.toISOString(),
    );
  }
  return true;
}
