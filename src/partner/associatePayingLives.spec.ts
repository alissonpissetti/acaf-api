import { countAssociatePayingLives } from './associatePayingLives';
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

  it('conta assinante ativo mesmo sem academia principal em unidade listada', () => {
    const store = {
      ...base,
      connectMembers: [
        {
          holderKey: 'maria teste',
          holderName: 'Maria Teste',
          connectPlanId: 'connect-plus',
          active: true,
          primaryUnitId: 'outra-unidade',
          primaryUnitName: 'Outra',
        },
      ],
    } as ApiStore;
    expect(countAssociatePayingLives(store)).toBe(1);
  });

  it('conta titular só com check-in de plano confirmado no mês, sem linha em connectMembers', () => {
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

  it('não conta pendência de check-in antes da confirmação do parceiro', () => {
    const store = {
      ...base,
      pendingCheckIns: [
        {
          id: 'p1',
          unitId,
          holderName: 'João Pendente',
          code: 'CHK-2',
          type: 'connect_member',
          requestedAt: new Date().toISOString(),
          status: 'pending',
        },
      ],
    } as ApiStore;
    expect(countAssociatePayingLives(store)).toBe(0);
  });

  it('deduplica assinante ativo e check-in do mesmo titular no mês', () => {
    const today = brDateKeyToday();
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
      checkInLog: [
        {
          id: 'ci-2',
          unitId,
          code: 'CHK-3',
          type: 'connect_member',
          holderName: 'Maria Teste',
          validatedAt: brLocalToUtcIso(today, 11, 0),
        },
      ],
    } as ApiStore;
    expect(countAssociatePayingLives(store)).toBe(1);
  });

  it('conta check-in de plano em qualquer unidade, não só associada listada', () => {
    const today = brDateKeyToday();
    const store = {
      ...base,
      units: [{ ...associateUnit(unitId), acafAssociate: undefined, id: 'rede-centro' }],
      checkInLog: [
        {
          id: 'ci-x',
          unitId: 'rede-centro',
          code: 'CHK-1',
          type: 'connect_member',
          holderName: 'João Check-in',
          validatedAt: brLocalToUtcIso(today, 10, 0),
        },
      ],
    } as ApiStore;
    expect(countAssociatePayingLives(store)).toBe(1);
  });

  it('ainda conta assinante ativo quando não há unidades associadas listadas', () => {
    const store = {
      ...base,
      units: [{ ...associateUnit(unitId), acafAssociate: undefined }],
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
    expect(countAssociatePayingLives(store)).toBe(1);
  });
});