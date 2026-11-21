import {
  countAssociatePayingLives,
  countAssociatePayingLivesForUnits,
  countCheckInEventsThisMonth,
} from './associatePayingLives';
import { brLocalToUtcIso, brDateKeyToday } from './gymLocalTime';
import type { ApiStore, GymUnit } from './types';

function associateUnit(id: string): GymUnit {
  return {
    id,
    unitName: 'Associada',
    modalities: [],
    dailyPassPrice: 0,
    dailyPassActive: false,
    dailyPassNotes: '',
    dailyPassModalities: [],
    planSpecs: [],
    acafAssociate: { listed: true, legalName: 'Academia Teste', cnpj: '00000000000100' },
  } as GymUnit;
}

describe('countAssociatePayingLives', () => {
  const unitId = 'un-assoc';
  const base: Partial<ApiStore> = {
    units: [associateUnit(unitId)],
    connectMembers: [],
    checkInLog: [],
    pendingCheckIns: [],
  };

  it('não conta assinante ativo sem check-in de plano no mês', () => {
    const store = {
      ...base,
      connectMembers: [
        {
          holderKey: 'maria teste',
          holderName: 'Maria Teste',
          connectPlanId: 'connect-plus',
          active: true,
          primaryUnitId: unitId,
          primaryUnitName: 'Associada',
        },
      ],
    } as ApiStore;
    expect(countAssociatePayingLives(store)).toBe(0);
  });

  it('conta titular com check-in de plano confirmado no mês, sem linha em connectMembers', () => {
    const today = brDateKeyToday();
    const store = {
      ...base,
      checkInLog: [
        {
          id: 'ci-1',
          unitId,
          code: 'CHK-1',
          type: 'connect_member',
          holderName: 'João Check-in',
          validatedAt: brLocalToUtcIso(today, 10, 0),
        },
      ],
    } as ApiStore;
    expect(countAssociatePayingLives(store)).toBe(1);
  });

  it('conta pendência de check-in de plano ainda aberta no mês', () => {
    const today = brDateKeyToday();
    const store = {
      ...base,
      pendingCheckIns: [
        {
          id: 'p1',
          unitId,
          holderName: 'João Pendente',
          code: 'CHK-2',
          type: 'connect_member',
          requestedAt: brLocalToUtcIso(today, 9, 30),
          status: 'pending',
        },
      ],
    } as ApiStore;
    expect(countAssociatePayingLives(store)).toBe(1);
  });

  it('conta check-in legado connect_visitor no mês', () => {
    const today = brDateKeyToday();
    const store = {
      ...base,
      checkInLog: [
        {
          id: 'ci-legacy',
          unitId,
          code: 'CHK-L',
          type: 'connect_visitor' as 'connect_member',
          holderName: 'Ana Legado',
          validatedAt: brLocalToUtcIso(today, 14, 0),
        },
      ],
    } as ApiStore;
    expect(countAssociatePayingLives(store)).toBe(1);
  });

  it('deduplica vários check-ins do mesmo titular no mês (uma vida pagante)', () => {
    const today = brDateKeyToday();
    const store = {
      ...base,
      checkInLog: [
        {
          id: 'ci-a',
          unitId,
          code: 'CHK-3',
          type: 'connect_member',
          holderName: 'Maria Teste',
          validatedAt: brLocalToUtcIso(today, 11, 0),
        },
        {
          id: 'ci-b',
          unitId,
          code: 'CHK-4',
          type: 'connect_member',
          holderName: 'Maria Teste',
          validatedAt: brLocalToUtcIso(today, 18, 0),
        },
      ],
    } as ApiStore;
    expect(countAssociatePayingLives(store)).toBe(1);
    expect(countCheckInEventsThisMonth(store)).toBe(2);
  });

  it('não conta diária avulsa no mês', () => {
    const today = brDateKeyToday();
    const store = {
      ...base,
      checkInLog: [
        {
          id: 'ci-daily',
          unitId,
          code: 'DLY-1',
          type: 'daily_pass',
          holderName: 'Visitante Diária',
          validatedAt: brLocalToUtcIso(today, 10, 0),
        },
      ],
    } as ApiStore;
    expect(countAssociatePayingLives(store)).toBe(0);
  });

  it('escopo por unidade: só check-ins nas unidades da associação', () => {
    const today = brDateKeyToday();
    const store = {
      ...base,
      checkInLog: [
        {
          id: 'ci-out',
          unitId: 'fora',
          code: 'CHK-O',
          type: 'connect_member',
          holderName: 'Visitante',
          validatedAt: brLocalToUtcIso(today, 10, 0),
        },
        {
          id: 'ci-in',
          unitId,
          code: 'CHK-I',
          type: 'connect_member',
          holderName: 'Associado',
          validatedAt: brLocalToUtcIso(today, 11, 0),
        },
      ],
    } as ApiStore;
    expect(countAssociatePayingLivesForUnits(store, new Set([unitId]))).toBe(1);
    expect(countAssociatePayingLives(store)).toBe(2);
  });
});