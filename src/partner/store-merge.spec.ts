import { mergeStoreOperationalData } from './store-merge';
import { createEmptyStore } from './store-normalize';
import type { ApiStore } from './types';

describe('mergeStoreOperationalData', () => {
  it('preserva check-ins do banco que faltam no snapshot em memória', () => {
    const base = createEmptyStore() as ApiStore;
    const incoming = structuredClone(base);
    base.checkInLog = [
      {
        id: 'ci-db',
        unitId: 'u1',
        code: 'CHK-1',
        type: 'connect_member',
        holderName: 'Maria',
        validatedAt: '2026-11-20T15:00:00.000Z',
      },
    ];
    incoming.checkInLog = [
      {
        id: 'ci-mem',
        unitId: 'u2',
        code: 'CHK-2',
        type: 'connect_member',
        holderName: 'João',
        validatedAt: '2026-11-21T10:00:00.000Z',
      },
    ];
    const merged = mergeStoreOperationalData(base, incoming);
    expect(merged.checkInLog).toHaveLength(2);
    expect(merged.checkInLog.map((e) => e.id).sort()).toEqual(['ci-db', 'ci-mem']);
  });

  it('une pendências de geo sem descartar as do disco', () => {
    const base = createEmptyStore() as ApiStore;
    const incoming = structuredClone(base);
    base.pendingCheckIns = [
      {
        id: 'p-db',
        unitId: 'u1',
        holderName: 'Ana',
        code: 'CHK-3',
        type: 'connect_member',
        requestedAt: '2026-11-21T09:00:00.000Z',
        status: 'pending',
      },
    ];
    incoming.pendingCheckIns = [];
    const merged = mergeStoreOperationalData(base, incoming);
    expect(merged.pendingCheckIns).toHaveLength(1);
    expect(merged.pendingCheckIns[0]?.id).toBe('p-db');
  });
});