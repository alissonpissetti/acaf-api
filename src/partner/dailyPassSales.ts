import { randomUUID } from 'node:crypto';
import type { ApiStore } from './types';
import { normalizeHolderKey } from './checkIn';
import { applyStudentStatsFromLog } from './student-stats';
import { brDateKeyToday } from './gymLocalTime';

const ACAF_FEE_PERCENT = 20;

function roundPrice(price: number): number {
  if (!Number.isFinite(price) || price < 0) return 0;
  return Math.round(price * 100) / 100;
}

function netFromGross(gross: number): number {
  return Math.round(gross * 100 * (1 - ACAF_FEE_PERCENT / 100)) / 100;
}

/**
 * Registra venda de diária no store (alunos, check-in log e repasse)
 * quando o app emite o código após pagamento.
 */
export function registerDailyPassPurchase(
  store: ApiStore,
  input: {
    unitId: string;
    holderName: string;
    code: string;
    pricePaid: number;
    occurrenceDate?: string;
  },
): void {
  const holderName = input.holderName.trim() || 'Visitante app';
  const codeNorm = input.code.trim().toUpperCase();
  const gross = roundPrice(input.pricePaid);
  const saleDate = input.occurrenceDate?.trim() || brDateKeyToday();
  const monthPrefix = saleDate.slice(0, 7);
  const holderKey = normalizeHolderKey(holderName);

  const alreadyLogged = store.checkInLog.some(
    (e) => e.code.toUpperCase() === codeNorm && e.type === 'daily_pass',
  );

  if (!alreadyLogged) {
    store.checkInLog.push({
      id: `ci-sale-${Date.now()}`,
      unitId: input.unitId,
      code: codeNorm,
      type: 'daily_pass',
      holderName,
      validatedAt: new Date().toISOString(),
      receptionNote: 'app_purchase',
    });
  }

  const existingStudent = store.students.find(
    (s) =>
      s.unitId === input.unitId &&
      s.channel === 'daily_pass' &&
      normalizeHolderKey(s.name) === holderKey,
  );

  if (!existingStudent) {
    store.students.push({
      id: `s-app-${randomUUID()}`,
      unitId: input.unitId,
      name: holderName,
      email: `app+${Date.now()}@acaf.local`,
      channel: 'daily_pass',
      checkInsThisMonth: 0,
      lastVisit: saleDate,
      dailyPassesThisMonth: 0,
      dailyPassPricePaid: gross,
    });
  } else {
    existingStudent.dailyPassPricePaid = gross;
  }

  store.students = applyStudentStatsFromLog(store.students, store.checkInLog, monthPrefix);

  const payout = store.payoutsByUnit[input.unitId];
  if (!payout) return;

  const sale = {
    id: `sale-${Date.now()}`,
    date: saleDate,
    studentName: holderName,
    gross,
    feePercent: ACAF_FEE_PERCENT,
    net: netFromGross(gross),
  };

  payout.recentDailySales = [sale, ...payout.recentDailySales].slice(0, 40);
  payout.dailyPassGross = roundPrice(payout.dailyPassGross + gross);
  payout.dailyPassNet = netFromGross(payout.dailyPassGross);
  payout.totalNet = roundPrice(payout.dailyPassNet + payout.connectRepasseTotal);

  const history = store.payoutHistoryByUnit[input.unitId];
  if (history?.length) {
    history[history.length - 1] = { ...payout };
  }
}
