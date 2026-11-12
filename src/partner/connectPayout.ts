import type { ApiStore, ConnectPlanId, MonthlyPayout } from './types';
import { getDomain } from './store';
import { resolveConnectFeePercentForUnit } from './platformFeePolicy';

function netFromGross(store: ApiStore, unitId: string, gross: number): number {
  const fee = resolveConnectFeePercentForUnit(store, unitId) / 100;
  return Math.round(gross * 100 * (1 - fee)) / 100;
}

function connectPlanIdsFromDomain(): ConnectPlanId[] {
  const domain = getDomain() as { connectPlans?: Array<{ id: string }> };
  return (domain.connectPlans ?? []).map((p) => p.id as ConnectPlanId);
}

function planPrice(planId: ConnectPlanId): number {
  const domain = getDomain() as { connectPlans?: Array<{ id: string; pricePerMonth?: number }> };
  const plan = domain.connectPlans?.find((p) => p.id === planId);
  if (plan?.pricePerMonth != null) return plan.pricePerMonth;
  const fallback: Partial<Record<ConnectPlanId, number>> = {
    'connect-start': 39.9,
    'connect-plus': 69.9,
    'connect-multi': 129.9,
    'connect-pro': 189.9,
    'connect-max': 299.9,
    'connect-prime': 399.9,
    'connect-elite': 549.9,
    'connect-signature': 699.9,
    'connect-infinite': 799.9,
  };
  return fallback[planId] ?? 0;
}

/** Recalcula linhas de repasse de assinaturas a partir dos membros com academia principal definida. */
export function recomputeConnectPayouts(store: ApiStore): void {
  const members = store.connectMembers ?? [];
  const activePrimary = members.filter((m) => m.active && m.primaryUnitId);

  for (const unit of store.units) {
    const payout = store.payoutsByUnit[unit.id];
    if (!payout) continue;

    const atUnit = activePrimary.filter((m) => m.primaryUnitId === unit.id);
    const planIds = connectPlanIdsFromDomain();

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
          repasseAmount: netFromGross(store, unit.id, gross),
        };
      })
      .filter((line): line is MonthlyPayout['connectLines'][number] => line != null);

    const connectGross = connectLines.reduce(
      (sum, line) => sum + line.activeMembers * planPrice(line.connectPlanId),
      0,
    );
    const connectRepasseTotal = netFromGross(store, unit.id, connectGross);

    const updated: MonthlyPayout = {
      ...payout,
      connectLines,
      connectRepasseTotal,
      totalNet: Math.round((payout.dailyPassNet + connectRepasseTotal) * 100) / 100,
    };

    store.payoutsByUnit[unit.id] = updated;

    const history = store.payoutHistoryByUnit[unit.id];
    if (history?.length) {
      const lastIdx = history.length - 1;
      const last = history[lastIdx];
      // Só atualiza repasse de planos no mês em aberto; meses fechados preservam o extrato histórico.
      if (last.status !== 'paid') {
        history[lastIdx] = {
          ...last,
          connectLines,
          connectRepasseTotal,
          totalNet: Math.round((last.dailyPassNet + connectRepasseTotal) * 100) / 100,
        };
      }
    }
  }
}
