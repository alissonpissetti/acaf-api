import { getDomain } from './store';
import type { ConnectPlanId } from './types';

export type PlanChangeKind = 'same' | 'upgrade' | 'downgrade';

export type ConnectPlanQuote = {
  id: ConnectPlanId;
  name: string;
  monthlyAmount: number;
};

export function resolveConnectPlanQuote(planId: ConnectPlanId): ConnectPlanQuote {
  const domain = getDomain() as {
    connectPlans?: Array<{ id: string; name?: string; pricePerMonth?: number }>;
  };
  const row = domain.connectPlans?.find((p) => p.id === planId);
  if (!row) {
    throw new Error('Plano não encontrado.');
  }
  return {
    id: planId,
    name: row.name ?? planId,
    monthlyAmount: Number(row.pricePerMonth ?? 0),
  };
}

export function comparePlanChangeKind(oldMonthly: number, newMonthly: number): PlanChangeKind {
  const delta = newMonthly - oldMonthly;
  if (Math.abs(delta) < 0.005) return 'same';
  return delta > 0 ? 'upgrade' : 'downgrade';
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Dia de aniversário mensal derivado da data de início da assinatura (`since`). */
export function nextPlanRenewalDate(since: Date, from: Date): Date {
  const anchorDay = since.getDate();
  let candidate = new Date(from.getFullYear(), from.getMonth(), anchorDay);
  if (candidate <= from) {
    candidate = new Date(from.getFullYear(), from.getMonth() + 1, anchorDay);
  }
  return candidate;
}

export function previousPlanRenewalDate(since: Date, from: Date): Date {
  const next = nextPlanRenewalDate(since, from);
  return new Date(next.getFullYear(), next.getMonth() - 1, next.getDate());
}

/**
 * Fração do ciclo mensal ainda não consumida (0–1). Usada para pró-rata em upgrade/downgrade.
 */
export function billingCycleRemainingFraction(sinceIso: string, now = new Date()): number {
  const since = new Date(sinceIso);
  if (Number.isNaN(since.getTime())) return 1;

  const cycleEnd = nextPlanRenewalDate(since, now);
  const cycleStart = previousPlanRenewalDate(since, now);
  const totalMs = cycleEnd.getTime() - cycleStart.getTime();
  if (totalMs <= 0) return 1;

  const leftMs = Math.max(0, cycleEnd.getTime() - now.getTime());
  return clamp01(leftMs / totalMs);
}

export function proRataMonthlyDelta(
  oldMonthly: number,
  newMonthly: number,
  sinceIso: string,
  now = new Date(),
): number {
  const kind = comparePlanChangeKind(oldMonthly, newMonthly);
  if (kind === 'same') return 0;
  const delta = Math.abs(newMonthly - oldMonthly);
  const fraction = billingCycleRemainingFraction(sinceIso, now);
  return roundMoney(delta * fraction);
}

export type PlanChangeAmounts = {
  kind: PlanChangeKind;
  oldMonthly: number;
  newMonthly: number;
  /** Valor a cobrar agora (upgrade). */
  upgradeChargeNow: number;
  /** Valor a registrar como recebível da plataforma (downgrade, ciclo corrente). */
  downgradeReceivable: number;
  cycleRemainingFraction: number;
};

export function computePlanChangeAmounts(
  oldMonthly: number,
  newMonthly: number,
  sinceIso: string,
  now = new Date(),
): PlanChangeAmounts {
  const kind = comparePlanChangeKind(oldMonthly, newMonthly);
  const cycleRemainingFraction = billingCycleRemainingFraction(sinceIso, now);
  const proRata = proRataMonthlyDelta(oldMonthly, newMonthly, sinceIso, now);

  return {
    kind,
    oldMonthly,
    newMonthly,
    upgradeChargeNow: kind === 'upgrade' ? proRata : 0,
    downgradeReceivable: kind === 'downgrade' ? proRata : 0,
    cycleRemainingFraction,
  };
}
