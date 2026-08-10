import type { ConnectPlanId, MonthlyPayout } from './types';

export function aggregatePayouts(payoutsByUnit: Record<string, MonthlyPayout>): MonthlyPayout {
  const list = Object.values(payoutsByUnit);
  if (list.length === 0) {
    return {
      monthLabel: '',
      dailyPassGross: 0,
      dailyPassNet: 0,
      connectRepasseTotal: 0,
      totalNet: 0,
      status: 'open',
      connectLines: [],
      recentDailySales: [],
    };
  }

  const monthLabel = list[0].monthLabel;
  let dailyPassGross = 0;
  let dailyPassNet = 0;
  let connectRepasseTotal = 0;
  const lineMap = new Map<
    string,
    { connectPlanId: ConnectPlanId; activeMembers: number; checkIns: number; repasseAmount: number }
  >();
  const sales = list.flatMap((p) => p.recentDailySales);

  for (const p of list) {
    dailyPassGross += p.dailyPassGross;
    dailyPassNet += p.dailyPassNet;
    connectRepasseTotal += p.connectRepasseTotal;
    for (const line of p.connectLines) {
      const prev = lineMap.get(line.connectPlanId);
      if (prev) {
        prev.activeMembers += line.activeMembers;
        prev.checkIns += line.checkIns;
        prev.repasseAmount += line.repasseAmount;
      } else {
        lineMap.set(line.connectPlanId, { ...line });
      }
    }
  }

  sales.sort((a, b) => b.date.localeCompare(a.date));

  return {
    monthLabel,
    dailyPassGross,
    dailyPassNet,
    connectRepasseTotal,
    totalNet: dailyPassNet + connectRepasseTotal,
    status: 'open',
    connectLines: [...lineMap.values()],
    recentDailySales: sales.slice(0, 40),
  };
}

export type UnitScope = 'single' | 'all';
