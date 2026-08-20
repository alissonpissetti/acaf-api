import { normalizeHolderKey } from './checkIn';
import { recomputeConnectPayouts } from './connectPayout';
import { updateStore } from './store';
import type { ApiStore } from './types';

export function purgeHolderFromStoreDraft(store: ApiStore, holderKey: string): boolean {
  if (!holderKey) return false;

  let changed = false;
  const matchesHolderName = (name: string) => normalizeHolderKey(name) === holderKey;

  const membersBefore = (store.connectMembers ?? []).length;
  store.connectMembers = (store.connectMembers ?? []).filter((member) => member.holderKey !== holderKey);
  if ((store.connectMembers ?? []).length !== membersBefore) changed = true;

  const studentsBefore = store.students.length;
  store.students = store.students.filter((student) => !matchesHolderName(student.name));
  if (store.students.length !== studentsBefore) changed = true;

  const checkInsBefore = store.checkInLog.length;
  store.checkInLog = store.checkInLog.filter((entry) => !matchesHolderName(entry.holderName));
  if (store.checkInLog.length !== checkInsBefore) changed = true;

  const pendingBefore = store.pendingCheckIns.length;
  store.pendingCheckIns = store.pendingCheckIns.filter((entry) => !matchesHolderName(entry.holderName));
  if (store.pendingCheckIns.length !== pendingBefore) changed = true;

  const codesBefore = store.issuedCodes.length;
  store.issuedCodes = store.issuedCodes.filter((entry) => !matchesHolderName(entry.holderName));
  if (store.issuedCodes.length !== codesBefore) changed = true;

  const reservationsBefore = (store.modalityReservations ?? []).length;
  store.modalityReservations = (store.modalityReservations ?? []).filter(
    (entry) => !matchesHolderName(entry.holderName),
  );
  if ((store.modalityReservations ?? []).length !== reservationsBefore) changed = true;

  const changesBefore = (store.primaryGymChanges ?? []).length;
  store.primaryGymChanges = (store.primaryGymChanges ?? []).filter(
    (entry) => entry.holderKey !== holderKey,
  );
  if ((store.primaryGymChanges ?? []).length !== changesBefore) changed = true;

  if (changed) {
    recomputeConnectPayouts(store);
  }

  return changed;
}

export function purgeHolderFromPartnerStore(holderName: string): boolean {
  const holderKey = normalizeHolderKey(holderName);
  if (!holderKey) return false;

  let changed = false;
  updateStore((store) => {
    changed = purgeHolderFromStoreDraft(store, holderKey);
  });
  return changed;
}
