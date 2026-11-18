import { createEmptyStore } from './store-normalize';
import { saveStore } from './store';
import { upsertConnectSubscription } from './connectMember';
import { isUnitTierEligibleForMember, subscribeUnitGymPlan } from './unit-gym-subscription';
import type { ApiStore } from './types';

function seedStore(partial: Partial<ApiStore> & Pick<ApiStore, 'units'>): void {
  const base = createEmptyStore();
  saveStore({ ...base, ...partial, units: partial.units });
}

describe('unit-gym-subscription', () => {
  beforeEach(() => {
    seedStore({
      units: [
        {
          id: 'centro',
          unitName: 'Unidade Centro',
          modalities: ['Musculação'],
          dailyPassPrice: 29.9,
          dailyPassActive: true,
          dailyPassNotes: '',
          dailyPassModalities: ['Musculação'],
          planSpecs: [],
        } as ApiStore['units'][number],
      ],
    });
  });

  it('isUnitTierEligibleForMember respeita tier', () => {
    expect(isUnitTierEligibleForMember('connect-plus', 'connect-start')).toBe(true);
    expect(isUnitTierEligibleForMember('connect-start', 'connect-plus')).toBe(false);
  });

  it('subscribeUnitGymPlan persiste assinatura e academia principal', () => {
    upsertConnectSubscription({
      holderName: 'Maria Teste',
      connectPlanId: 'connect-plus',
      active: true,
    });

    const profile = subscribeUnitGymPlan({
      holderName: 'Maria Teste',
      unitId: 'centro',
      planId: 'unit_centro_connect-plus',
      connectPlanId: 'connect-plus',
      planName: 'Plus',
      pricePerMonth: 69.9,
    });

    expect(profile.primaryUnitId).toBe('centro');
    expect(profile.unitSubscription?.unitId).toBe('centro');
    expect(profile.unitSubscription?.connectPlanId).toBe('connect-plus');
  });
});