import {
  billingCycleRemainingFraction,
  comparePlanChangeKind,
  computePlanChangeAmounts,
  proRataMonthlyDelta,
  roundMoney,
} from './connect-plan-pricing';

describe('connect-plan-pricing', () => {
  it('classifica upgrade, downgrade e plano igual', () => {
    expect(comparePlanChangeKind(39.8, 69.9)).toBe('upgrade');
    expect(comparePlanChangeKind(129.9, 69.9)).toBe('downgrade');
    expect(comparePlanChangeKind(50, 50)).toBe('same');
  });

  it('arredonda valores monetários em centavos', () => {
    expect(roundMoney(10.005)).toBe(10.01);
    expect(roundMoney(10.004)).toBe(10);
  });

  it('calcula pró-rata com fração de ciclo', () => {
    const since = '2025-01-10T12:00:00.000Z';
  const now = new Date('2025-01-20T12:00:00.000Z');
    const fraction = billingCycleRemainingFraction(since, now);
    expect(fraction).toBeGreaterThan(0.5);
    expect(fraction).toBeLessThanOrEqual(1);

    const proRata = proRataMonthlyDelta(39.8, 69.9, since, now);
    expect(proRata).toBeGreaterThan(0);
    expect(proRata).toBeLessThan(69.9 - 39.8);
  });

  it('monta valores de upgrade e downgrade', () => {
    const since = '2025-06-01T00:00:00.000Z';
    const now = new Date('2025-06-15T12:00:00.000Z');

    const upgrade = computePlanChangeAmounts(39.8, 69.9, since, now);
    expect(upgrade.kind).toBe('upgrade');
    expect(upgrade.upgradeChargeNow).toBeGreaterThan(0);
    expect(upgrade.downgradeReceivable).toBe(0);

    const downgrade = computePlanChangeAmounts(129.9, 69.9, since, now);
    expect(downgrade.kind).toBe('downgrade');
    expect(downgrade.downgradeReceivable).toBeGreaterThan(0);
    expect(downgrade.upgradeChargeNow).toBe(0);
  });
});
