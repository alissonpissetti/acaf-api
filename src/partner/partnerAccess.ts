import type { ApiStore } from './types';

export function filterStoreByUnitIds(store: ApiStore, allowedUnitIds: string[]): ApiStore {
  const allowed = new Set(allowedUnitIds);
  const units = store.units.filter((unit) => allowed.has(unit.id));
  const unitIdSet = new Set(units.map((unit) => unit.id));
  const activeUnitId = units.some((unit) => unit.id === store.activeUnitId)
    ? store.activeUnitId
    : (units[0]?.id ?? '');

  const activeUnit = units.find((unit) => unit.id === activeUnitId);
  const network = activeUnit
    ? store.networks.find((item) => item.id === activeUnit.networkId)
    : null;

  return {
    ...store,
    networkId: network?.id ?? store.networkId,
    networkName: network?.name ?? store.networkName,
    activeUnitId,
    units,
    students: store.students.filter((student) => unitIdSet.has(student.unitId)),
    checkInLog: store.checkInLog.filter((entry) => unitIdSet.has(entry.unitId)),
    pendingCheckIns: store.pendingCheckIns.filter((entry) => unitIdSet.has(entry.unitId)),
    issuedCodes: store.issuedCodes.filter((entry) => unitIdsHas(unitIdSet, entry.unitId)),
    payoutsByUnit: pickByKeys(store.payoutsByUnit, unitIdSet),
    payoutHistoryByUnit: pickByKeys(store.payoutHistoryByUnit, unitIdSet),
  };
}

function unitIdsHas(set: Set<string>, unitId: string) {
  return set.has(unitId);
}

function pickByKeys<T>(record: Record<string, T>, keys: Set<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => keys.has(key)));
}

import { ForbiddenException } from '@nestjs/common';

export function assertUnitAccess(unitId: string, allowedUnitIds: string[]) {
  if (!allowedUnitIds.includes(unitId)) {
    throw new ForbiddenException('Sem acesso a esta unidade.');
  }
}
