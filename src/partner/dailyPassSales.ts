import { randomUUID } from 'node:crypto';
import type { ApiStore } from './types';
import { normalizeHolderKey } from './checkIn';
import { applyStudentStatsFromLog } from './student-stats';
import { brDateKeyToday } from './gymLocalTime';
import { resolveDailyFeePercentForUnit } from './platformFeePolicy';

function roundPrice(price: number): number {
  if (!Number.isFinite(price) || price < 0) return 0;
  return Math.round(price * 100) / 100;
}

function netFromGross(store: ApiStore, unitId: string, gross: number): number {
  const pct = resolveDailyFeePercentForUnit(store, unitId);
  return Math.round(gross * 100 * (1 - pct / 100)) / 100;
}

/**
 * Atualiza totais de diária e lista recente quando a política de taxa muda (ex.: override no admin).
 * Só altera o mês em aberto (mesma regra que `registerDailyPassPurchase`).
 */
export function recalcDailyPassNetForOpenPayout(store: ApiStore, unitId: string): void {
  const payout = store.payoutsByUnit[unitId];
  if (!payout) return;

  const pct = resolveDailyFeePercentForUnit(store, unitId);

  for (const sale of payout.recentDailySales) {
    sale.feePercent = pct;
    sale.net = netFromGross(store, unitId, sale.gross);
  }

  payout.dailyPassNet = netFromGross(store, unitId, payout.dailyPassGross);
  payout.totalNet = Math.round((payout.dailyPassNet + payout.connectRepasseTotal) * 100) / 100;

  const history = store.payoutHistoryByUnit[unitId];
  if (history?.length) {
    const lastIdx = history.length - 1;
    const last = history[lastIdx];
    if (last.status !== 'paid') {
      history[lastIdx] = {
        ...last,
        recentDailySales: payout.recentDailySales,
        dailyPassNet: payout.dailyPassNet,
        totalNet: payout.totalNet,
      };
    }
  }
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
    companyName?: string;
    companySlug?: string;
  },
): void {
  const holderName = input.holderName.trim() || 'Visitante app';
  const codeNorm = input.code.trim().toUpperCase();
  const gross = roundPrice(input.pricePaid);
  const saleDate = input.occurrenceDate?.trim() || brDateKeyToday();
  const monthPrefix = saleDate.slice(0, 7);
  const holderKey = normalizeHolderKey(holderName);
  const companyName = input.companyName?.trim();
  const companySlug = input.companySlug?.trim();

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
      email: `app+${Date.now()}@local.test`,
      channel: 'daily_pass',
      checkInsThisMonth: 0,
      lastVisit: saleDate,
      dailyPassesThisMonth: 0,
      dailyPassPricePaid: gross,
      companyName: companyName || undefined,
      companySlug: companySlug || undefined,
    });
  } else {
    existingStudent.dailyPassPricePaid = gross;
    if (companyName && !existingStudent.companyName?.trim()) {
      existingStudent.companyName = companyName;
    }
    if (companySlug && !existingStudent.companySlug?.trim()) {
      existingStudent.companySlug = companySlug;
    }
  }

  store.students = applyStudentStatsFromLog(store.students, store.checkInLog, monthPrefix);

  const payout = store.payoutsByUnit[input.unitId];
  if (!payout) return;

  const feePercent = resolveDailyFeePercentForUnit(store, input.unitId);
  const sale = {
    id: `sale-${Date.now()}`,
    date: saleDate,
    studentName: holderName,
    gross,
    feePercent,
    net: netFromGross(store, input.unitId, gross),
    unitId: input.unitId,
  };

  payout.recentDailySales = [sale, ...payout.recentDailySales].slice(0, 40);
  payout.dailyPassGross = roundPrice(payout.dailyPassGross + gross);
  payout.dailyPassNet = netFromGross(store, input.unitId, payout.dailyPassGross);
  payout.totalNet = roundPrice(payout.dailyPassNet + payout.connectRepasseTotal);

  const history = store.payoutHistoryByUnit[input.unitId];
  if (history?.length) {
    history[history.length - 1] = { ...payout };
  }
}
