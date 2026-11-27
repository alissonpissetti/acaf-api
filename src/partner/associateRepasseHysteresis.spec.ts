import {
  DAYS_TO_IMPROVE_REPASSE,
  DAYS_TO_REDUCE_REPASSE,
  MAX_NET_CHURN_PERCENT_MONTHLY,
  ASSOCIATE_REPASSE_TIMEZONE,
  buildDailySnapshot,
  formatDateYyyyMmDdInTimeZone,
  netChurnPercentForMonthBeforeTransitionDate,
  rebuildAssociateRepasseSnapshotsForMonth,
  recomputeAssociateRepasseEffective,
  resolveMonthlyPayingLivesCount,
  syncAssociateRepasseState,
} from './associateRepasseHysteresis';
import { brDateKeyToday, brLocalToUtcIso } from './gymLocalTime';
import { createEmptyStore } from './store-normalize';
import type { ApiStore } from './types';

describe('associateRepasseHysteresis', () => {
  /** YYYY-MM-DD para um offset de dias a partir de 2026-01-01 */
  const dayOffset = (offset: number) => {
    const base = new Date(Date.UTC(2026, 0, 1));
    base.setUTCDate(base.getUTCDate() + offset);
    return base.toISOString().slice(0, 10);
  };

  it('mantém repasse inicial no primeiro dia', () => {
    const rows = [buildDailySnapshot(1000, dayOffset(0))];
    const eff = recomputeAssociateRepasseEffective(rows, '2026-01-01T12:00:00.000Z');
    expect(eff?.repassePercent).toBe(22.01);
    expect(eff?.tierId).toBe('l1');
  });

  it('só aumenta % de repasse após 90 dias consecutivos na faixa melhor (vidas menores → l1)', () => {
    const rows = [];
    for (let i = 0; i < 10; i++) {
      rows.push(buildDailySnapshot(3000, dayOffset(i)));
    }
    for (let i = 10; i < 99; i++) {
      rows.push(buildDailySnapshot(1000, dayOffset(i)));
    }
    let eff = recomputeAssociateRepasseEffective(rows, '2026-04-01T12:00:00.000Z');
    expect(eff?.repassePercent).toBe(21.05);

    rows.push(buildDailySnapshot(1000, dayOffset(99)));
    eff = recomputeAssociateRepasseEffective(rows, '2026-04-01T12:00:00.000Z');
    expect(eff?.repassePercent).toBe(22.01);
    expect(DAYS_TO_IMPROVE_REPASSE).toBe(90);
  });

  it('reduz % de repasse após 30 dias consecutivos na faixa pior (vidas maiores → l2)', () => {
    const rows = [];
    for (let i = 0; i < 5; i++) {
      rows.push(buildDailySnapshot(1000, dayOffset(i)));
    }
    for (let i = 5; i < 35; i++) {
      rows.push(buildDailySnapshot(3000, dayOffset(i)));
    }
    const eff = recomputeAssociateRepasseEffective(rows, '2026-02-01T12:00:00.000Z');
    expect(eff?.repassePercent).toBe(21.05);
    expect(DAYS_TO_REDUCE_REPASSE).toBe(30);
  });

  it('calcula churn líquido do mês civil anterior (queda vs início do mês)', () => {
    const rows = [
      buildDailySnapshot(1000, '2026-02-01'),
      buildDailySnapshot(900, '2026-02-28'),
    ];
    const churn = netChurnPercentForMonthBeforeTransitionDate(rows, '2026-03-15');
    expect(churn.referenceMonthKey).toBe('2026-02');
    expect(churn.netChurnPercent).toBe(10);
    expect(churn.insufficientData).toBe(false);
    expect(MAX_NET_CHURN_PERCENT_MONTHLY).toBe(3);
  });

  it('não muda faixa se churn do mês anterior exceder o teto, mesmo com streak de 90 dias na faixa alvo', () => {
    const rows: ReturnType<typeof buildDailySnapshot>[] = [];
    const addRange = (from: Date, to: Date, lives: number) => {
      const d = new Date(from);
      while (d <= to) {
        const ymd = d.toISOString().slice(0, 10);
        rows.push(buildDailySnapshot(lives, ymd));
        d.setUTCDate(d.getUTCDate() + 1);
      }
    };
    addRange(new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 1, 28)), 3000);
    addRange(new Date(Date.UTC(2026, 2, 1)), new Date(Date.UTC(2026, 3, 29)), 1000);
    rows.push(buildDailySnapshot(949, '2026-04-30'));
    addRange(new Date(Date.UTC(2026, 4, 1)), new Date(Date.UTC(2026, 4, 28)), 1000);

    const churnApr = netChurnPercentForMonthBeforeTransitionDate(rows, '2026-05-29');
    expect(churnApr.referenceMonthKey).toBe('2026-04');
    expect(churnApr.netChurnPercent).toBeGreaterThan(MAX_NET_CHURN_PERCENT_MONTHLY);

    const eff = recomputeAssociateRepasseEffective(rows, '2026-05-30T12:00:00.000Z');
    expect(eff?.repassePercent).toBe(21.05);
  });

  it('mantém pico do mês civil: não reduz vidas pagantes no mesmo mês', () => {
    const store = createEmptyStore() as ApiStore;
    store.associateRepasseSnapshots = [buildDailySnapshot(10, '2026-03-14')];
    expect(resolveMonthlyPayingLivesCount(store, 0, '2026-03-15')).toBe(10);
    expect(resolveMonthlyPayingLivesCount(store, 12, '2026-03-15')).toBe(12);
  });

  it('recomeça contagem ao mudar o mês civil', () => {
    const store = createEmptyStore() as ApiStore;
    store.associateRepasseSnapshots = [buildDailySnapshot(40, '2026-02-28')];
    expect(resolveMonthlyPayingLivesCount(store, 0, '2026-03-01')).toBe(0);
    expect(resolveMonthlyPayingLivesCount(store, 3, '2026-03-01')).toBe(3);
  });

  it('atualiza o snapshot do dia quando vidas pagantes mudam no mesmo dia', () => {
    const now = new Date(brLocalToUtcIso(brDateKeyToday(), 16, 0));
    const dateStr = formatDateYyyyMmDdInTimeZone(now, ASSOCIATE_REPASSE_TIMEZONE);
    const store = {
      ...createEmptyStore(),
      associateRepasseSnapshots: [buildDailySnapshot(0, dateStr)],
      checkInLog: [],
      connectMembers: [],
    } as ApiStore;
    const today = brDateKeyToday();
    store.checkInLog.push({
      id: 'ci-sync',
      unitId: 'u1',
      code: 'CHK-SYNC',
      type: 'connect_member',
      holderName: 'Titular Sync',
      validatedAt: brLocalToUtcIso(today, 10, 0),
    });
    store.units = [
      {
        id: 'u1',
        unitName: 'Centro',
        modalities: [],
        dailyPassPrice: 0,
        dailyPassActive: false,
        dailyPassNotes: '',
        dailyPassModalities: [],
        planSpecs: [],
      } as ApiStore['units'][number],
    ];

    const changed = syncAssociateRepasseState(store, now);
    expect(changed).toBe(true);
    expect(store.associateRepasseSnapshots?.find((s) => s.date === dateStr)?.payingLivesCount).toBe(1);
  });

  it('reconstrói snapshots anteriores no mês após check-in de teste (dias sem job diário)', () => {
    const today = brDateKeyToday();
    const monthKey = today.slice(0, 7);
    const checkInDay = new Date();
    checkInDay.setDate(checkInDay.getDate() - 4);
    const checkInYmd = formatDateYyyyMmDdInTimeZone(checkInDay, ASSOCIATE_REPASSE_TIMEZONE);
    expect(checkInYmd.startsWith(monthKey)).toBe(true);

    const now = new Date(brLocalToUtcIso(today, 16, 0));
    const dateStr = formatDateYyyyMmDdInTimeZone(now, ASSOCIATE_REPASSE_TIMEZONE);
    const store = {
      ...createEmptyStore(),
      associateRepasseSnapshots: [
        buildDailySnapshot(0, `${monthKey}-01`),
        buildDailySnapshot(0, checkInYmd),
        buildDailySnapshot(1, dateStr),
      ],
      checkInLog: [],
      connectMembers: [],
    } as ApiStore;
    store.checkInLog.push({
      id: 'ci-backfill',
      unitId: 'u1',
      code: 'CHK-BF',
      type: 'connect_member',
      holderName: 'Titular Teste',
      validatedAt: brLocalToUtcIso(checkInYmd, 11, 0),
    });
    store.units = [
      {
        id: 'u1',
        unitName: 'Centro',
        modalities: [],
        dailyPassPrice: 0,
        dailyPassActive: false,
        dailyPassNotes: '',
        dailyPassModalities: [],
        planSpecs: [],
      } as ApiStore['units'][number],
    ];

    const rebuilt = rebuildAssociateRepasseSnapshotsForMonth(store, monthKey, dateStr);
    expect(rebuilt).toBe(true);

    const snapOnCheckIn = store.associateRepasseSnapshots?.find((s) => s.date === checkInYmd);
    expect(snapOnCheckIn?.payingLivesCount).toBe(1);

    for (const row of store.associateRepasseSnapshots ?? []) {
      if (row.date >= checkInYmd && row.date <= dateStr) {
        expect(row.payingLivesCount).toBeGreaterThanOrEqual(1);
      }
    }

    syncAssociateRepasseState(store, now);
    expect(store.associateRepasseSnapshots?.find((s) => s.date === checkInYmd)?.payingLivesCount).toBe(1);
  });
});
