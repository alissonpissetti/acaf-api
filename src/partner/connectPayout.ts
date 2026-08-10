import type { ApiStore, ConnectPlanId, MonthlyPayout } from './types';
import { getDomain } from './store';

const FEE_PERCENT_FALLBACK = 20;

function feePercent(): number {
  const domain = getDomain() as { acafConnectFeePercent?: number };
  return domain.acafConnectFeePercent ?? FEE_PERCENT_FALLBACK;
}

function netFromGross(gross: number): number {
  const fee = feePercent() / 100;
  return Math.round(gross * 100 * (1 - fee)) / 100;
}

function planPrice(planId: ConnectPlanId): number {
  const domain = getDomain() as { connectPlans?: Array<{ id: string; pricePerMonth?: number }> };
  const plan = domain.connectPlans?.find((p) => p.id === planId);
  if (plan?.pricePerMonth != null) return plan.pricePerMonth;
  const fallback: Record<ConnectPlanId, number> = {
    'connect-start': 39.9,
    'connect-plus': 69.9,
    'connect-multi': 129.9,
    'connect-pro': 189.9,
    'connect-total': 299.9,
  };
  return fallback[planId];
}

/** Recalcula linhas de repasse Connect a partir dos membros com academia principal definida. */
export function recomputeConnectPayouts(store: ApiStore): void {
  const members = store.connectMembers ?? [];
  const activePrimary = members.filter((m) => m.active && m.primaryUnitId);

  for (const unit of store.units) {
    const payout = store.payoutsByUnit[unit.id];
    if (!payout) continue;

    const atUnit = activePrimary.filter((m) => m.primaryUnitId === unit.id);
    const planIds: ConnectPlanId[] = [
      'connect-start',
      'connect-plus',
      'connect-multi',
      'connect-pro',
      'connect-total',
    ];

    const connectLines = planIds
      .map((planId) => {
        const group = atUnit.filter((m) => m.connectPlanId === planId);
        if (!group.length) return null;
        const activeMembers = group.length;
        const checkIns = group.reduce((sum, m) => sum + m.primaryCheckInsSinceFirst, 0);
        const gross = activeMembers * planPrice(planId);
        return {
          connectPlanId: planId,
          activeMembers,
          checkIns: Math.max(activeMembers, checkIns),
          repasseAmount: netFromGross(gross),
        };
      })
      .filter((line): line is MonthlyPayout['connectLines'][number] => line != null);

    const connectGross = connectLines.reduce(
      (sum, line) => sum + line.activeMembers * planPrice(line.connectPlanId),
      0,
    );
    const connectRepasseTotal = netFromGross(connectGross);

    const updated: MonthlyPayout = {
      ...payout,
      connectLines,
      connectRepasseTotal,
      totalNet: Math.round((payout.dailyPassNet + connectRepasseTotal) * 100) / 100,
    };

    store.payoutsByUnit[unit.id] = updated;

    const history = store.payoutHistoryByUnit[unit.id];
    if (history?.length) {
      history[history.length - 1] = { ...updated };
    }
  }
}
