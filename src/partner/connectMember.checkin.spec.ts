import { createEmptyStore } from './store-normalize';
import { loadStore, saveStore } from './store';
import {
  getConnectMemberProfileByUserId,
  listConnectMemberCheckInsForUser,
  upsertConnectSubscription,
  validateConnectCheckInAtUnit,
  setConnectPrimaryGym,
} from './connectMember';
import { requestGeoCheckIn } from './checkIn';
import { approvePendingCheckIn } from './pendingCheckIn';
import type { ApiStore } from './types';

function seedStore(partial: Partial<ApiStore>): void {
  const base = createEmptyStore();
  saveStore({ ...base, ...partial });
}

describe('connectMember check-in', () => {
  const platformUserId = '11111111-1111-4111-8111-111111111111';

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
          latitude: -23.55,
          longitude: -46.63,
        } as ApiStore['units'][number],
      ],
    });
    upsertConnectSubscription({
      holderName: 'Maria Corporativa',
      connectPlanId: 'connect-plus',
      active: true,
      userId: platformUserId,
    });
    setConnectPrimaryGym('Maria Corporativa', 'centro');
  });

  it('validateConnectCheckInAtUnit resolve membro pelo userId quando holderName é placeholder', () => {
    const store = loadStore();
    const err = validateConnectCheckInAtUnit(store, 'Associado', 'centro', {
      userId: platformUserId,
    });
    expect(err).toBeNull();
  });

  it('validateConnectCheckInAtUnit orienta quando titular não é encontrado sem login', () => {
    const store = loadStore();
    const err = validateConnectCheckInAtUnit(store, 'Associado', 'centro');
    expect(err).toMatch(/Entre na sua conta/i);
  });

  it('requestGeoCheckIn autoriza com userId mesmo se holderName não bater com o cadastro', () => {
    const store = loadStore();
    const day = new Date().getDate();
    const code = `CHK-CENTRO-${day}`;
    const result = requestGeoCheckIn(store, 'centro', code, 'Associado', -23.55, -46.63, {
      memberUserId: platformUserId,
    });
    expect(result.ok).toBe(true);
  });

  it('listConnectMemberCheckInsForUser inclui pendência e confirmado após aprovação', () => {
    const store = loadStore();
    const day = new Date().getDate();
    const code = `CHK-CENTRO-${day}`;
    const result = requestGeoCheckIn(store, 'centro', code, 'Associado', -23.55, -46.63, {
      memberUserId: platformUserId,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe('pending_partner');
    }
    saveStore(store);

    let listed = listConnectMemberCheckInsForUser(platformUserId, { limit: 10 });
    expect(listed.total).toBe(1);
    expect(listed.items[0]?.status).toBe('pending_partner');

    const profilePending = getConnectMemberProfileByUserId(platformUserId);
    expect(profilePending?.pendingCheckInToday).toBe(true);
    expect(profilePending?.confirmedCheckInToday).toBe(false);

    const after = loadStore();
    const pendingId = after.pendingCheckIns[0]?.id ?? '';
    approvePendingCheckIn(after, pendingId, 'centro');
    saveStore(after);

    listed = listConnectMemberCheckInsForUser(platformUserId, { limit: 10 });
    expect(listed.total).toBe(1);
    expect(listed.items[0]?.status).toBe('validated');
    expect(listed.items[0]?.modalityLabel).toBe('Plano Movly');
    expect(listed.items[0]?.validatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const profileConfirmed = getConnectMemberProfileByUserId(platformUserId);
    expect(profileConfirmed?.confirmedCheckInToday).toBe(true);
    expect(profileConfirmed?.pendingCheckInToday).toBe(false);
  });
});