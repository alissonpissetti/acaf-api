import { reconcileConnectMemberForPlatformUser } from './connectMember';
import type { ApiStore, ConnectMemberRecord } from './types';

describe('reconcileConnectMemberForPlatformUser', () => {
  const user = {
    id: 'user-1',
    name: 'Alisson Pissetti',
    email: 'galoveio@gmail.com',
    cpf: '24971563792',
  };

  it('desativa titular duplicado com mesmo userId e prefere e-mail real', () => {
    const members: ConnectMemberRecord[] = [
      {
        holderKey: 'alisson a pissetti',
        holderName: 'Alisson A Pissetti',
        holderEmail: 'alisson.a.pissetti@connect.movly.app',
        connectPlanId: 'plus',
        active: true,
        since: '2026-01-01T00:00:00.000Z',
        primaryUnitId: 'unit-1',
        primaryUnitName: 'Centro',
        primaryChosenAt: '2026-01-02T00:00:00.000Z',
        primaryFirstCheckInAt: null,
        primaryCheckInsSinceFirst: 0,
        userId: 'user-1',
      },
      {
        holderKey: 'alisson pissetti',
        holderName: 'Alisson Pissetti',
        holderEmail: 'alisson.pissetti@connect.movly.app',
        connectPlanId: 'plus',
        active: true,
        since: '2026-01-03T00:00:00.000Z',
        primaryUnitId: 'unit-1',
        primaryUnitName: 'Centro',
        primaryChosenAt: '2026-01-03T00:00:00.000Z',
        primaryFirstCheckInAt: '2026-01-04T00:00:00.000Z',
        primaryCheckInsSinceFirst: 1,
        userId: 'user-1',
      },
    ];

    const store: ApiStore = {
      connectMembers: members,
      students: [],
      units: [{ id: 'unit-1', unitName: 'Centro', networkId: 'net-1', modalities: [] }],
    } as unknown as ApiStore;

    reconcileConnectMemberForPlatformUser(store, user);

    const activePrimary = (store.connectMembers ?? []).filter(
      (m) => m.userId === 'user-1' && m.active && m.primaryUnitId,
    );
    expect(activePrimary).toHaveLength(1);
    expect(activePrimary[0]?.holderEmail).toBe('galoveio@gmail.com');
    expect(activePrimary[0]?.holderName).toBe('Alisson Pissetti');

    const inactive = (store.connectMembers ?? []).find(
      (m) => m.holderKey === 'alisson a pissetti',
    );
    expect(inactive?.active).toBe(false);
    expect(inactive?.primaryUnitId).toBeNull();
  });
});