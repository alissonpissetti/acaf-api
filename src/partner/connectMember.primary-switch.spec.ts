import { createEmptyStore } from './store-normalize';
import { loadStore, saveStore } from './store';
import {
  memberCanChangePrimary,
  remainingCheckInsBeforeChange,
  setConnectPrimaryGym,
  upsertConnectSubscription,
} from './connectMember';
import { subscribeUnitGymPlan } from './unit-gym-subscription';
import type { ApiStore } from './types';

function seedStore(partial: Partial<ApiStore>): void {
  const base = createEmptyStore();
  saveStore({ ...base, ...partial });
}

describe('troca de academia principal (check-ins confirmados)', () => {
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
        {
          id: 'imperio',
          unitName: 'Nova Império',
          modalities: ['Musculação'],
          dailyPassPrice: 29.9,
          dailyPassActive: true,
          dailyPassNotes: '',
          dailyPassModalities: ['Musculação'],
          planSpecs: [],
        } as ApiStore['units'][number],
      ],
    });
    upsertConnectSubscription({
      holderName: 'Maria Teste',
      connectPlanId: 'connect-plus',
      active: true,
    });
    setConnectPrimaryGym('Maria Teste', 'centro');
  });

  it('bloqueia troca sem check-in confirmado na principal', () => {
    const store = loadStore();
    const member = store.connectMembers?.[0]!;
    expect(member.primaryUnitId).toBe('centro');
    expect(member.primaryCheckInsSinceFirst).toBe(0);
    expect(memberCanChangePrimary(member)).toBe(false);
    expect(remainingCheckInsBeforeChange(member)).toBe(12);
  });

  it('bloqueia setConnectPrimaryGym em outra unidade com 1 check-in confirmado', () => {
    const store = loadStore();
    const idx = store.connectMembers!.findIndex((m) => m.holderName === 'Maria Teste');
    store.connectMembers![idx] = {
      ...store.connectMembers![idx],
      primaryCheckInsSinceFirst: 1,
      primaryFirstCheckInAt: new Date().toISOString(),
    };
    saveStore(store);

    expect(() => setConnectPrimaryGym('Maria Teste', 'imperio')).toThrow(/1 de 12/);
  });

  it('bloqueia subscribeUnitGymPlan em outra unidade com check-ins insuficientes', () => {
    const store = loadStore();
    const idx = store.connectMembers!.findIndex((m) => m.holderName === 'Maria Teste');
    store.connectMembers![idx] = {
      ...store.connectMembers![idx],
      primaryCheckInsSinceFirst: 1,
      primaryFirstCheckInAt: new Date().toISOString(),
    };
    saveStore(store);

    expect(() =>
      subscribeUnitGymPlan({
        holderName: 'Maria Teste',
        unitId: 'imperio',
        planId: 'unit_imperio_connect-plus',
        connectPlanId: 'connect-plus',
        planName: 'Plus',
        pricePerMonth: 69.9,
      }),
    ).toThrow(/1 de 12/);
  });
});