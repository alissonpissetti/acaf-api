import { createEmptyStore } from './store-normalize';
import { loadStore, saveStore } from './store';
import {
  duplicateCheckInTodayMessage,
  hasCheckInTodayForPerson,
  requestGeoCheckIn,
  validateCheckInCode,
} from './checkIn';
import { approvePendingCheckIn } from './pendingCheckIn';
import { setConnectPrimaryGym, upsertConnectSubscription } from './connectMember';
import type { ApiStore } from './types';

const platformUserId = '11111111-1111-4111-8111-111111111111';

function seedStore(partial: Partial<ApiStore>): void {
  const base = createEmptyStore();
  saveStore({ ...base, ...partial });
}

describe('check-in diário após confirmação do parceiro', () => {
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

  it('geo check-in cria pendência e não bloqueia novo envio antes da confirmação', () => {
    const store = loadStore();
    const day = new Date().getDate();
    const code = `CHK-CENTRO-${day}`;

    const first = requestGeoCheckIn(store, 'centro', code, 'Maria Corporativa', -23.55, -46.63, {
      memberUserId: platformUserId,
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.status).toBe('pending_partner');
    }
    expect(store.checkInLog).toHaveLength(0);
    expect(store.pendingCheckIns).toHaveLength(1);

    expect(
      hasCheckInTodayForPerson(store, 'centro', 'Maria Corporativa', 'connect_member', code),
    ).toBe(false);

    const codeResult = validateCheckInCode(store, 'centro', code);
    expect(codeResult.ok).toBe(true);
    const duplicate = duplicateCheckInTodayMessage(
      store,
      'centro',
      codeResult as Extract<typeof codeResult, { ok: true }>,
      code,
    );
    expect(duplicate).toBeNull();

    const second = requestGeoCheckIn(store, 'centro', code, 'Maria Corporativa', -23.55, -46.63, {
      memberUserId: platformUserId,
    });
    expect(second.ok).toBe(true);
    expect(store.pendingCheckIns.filter((p) => p.status === 'pending')).toHaveLength(1);
  });

  it('após aprovar na recepção, bloqueia novo check-in no mesmo dia', () => {
    const store = loadStore();
    const day = new Date().getDate();
    const code = `CHK-CENTRO-${day}`;

    const geo = requestGeoCheckIn(store, 'centro', code, 'Maria Corporativa', -23.55, -46.63, {
      memberUserId: platformUserId,
    });
    expect(geo.ok).toBe(true);
    const pendingId = geo.ok ? geo.pendingId : '';
    saveStore(store);

    const updated = loadStore();
    const approved = approvePendingCheckIn(updated, pendingId, 'centro');
    expect(approved.ok).toBe(true);
    expect(updated.checkInLog).toHaveLength(1);
    saveStore(updated);

    const after = loadStore();
    const blocked = requestGeoCheckIn(after, 'centro', code, 'Maria Corporativa', -23.55, -46.63, {
      memberUserId: platformUserId,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.message).toMatch(/1 entrada por dia/i);
    }
  });
});