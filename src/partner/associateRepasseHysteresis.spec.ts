import {
  DAYS_TO_IMPROVE_REPASSE,
  DAYS_TO_REDUCE_REPASSE,
  MAX_NET_CHURN_PERCENT_MONTHLY,
  buildDailySnapshot,
  netChurnPercentForMonthBeforeTransitionDate,
  recomputeAssociateRepasseEffective,
} from './associateRepasseHysteresis';

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
});
