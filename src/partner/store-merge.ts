import type { CheckInLogEntry } from './types';
import type { PendingCheckInRequest } from './pendingCheckIn';
import type { ApiStore } from './types';

function mergeById<T extends { id: string }>(
  left: T[],
  right: T[],
  tieBreak: (a: T, b: T) => T,
): T[] {
  const map = new Map<string, T>();
  for (const item of left) {
    if (item.id) map.set(item.id, item);
  }
  for (const item of right) {
    if (!item.id) continue;
    const prev = map.get(item.id);
    map.set(item.id, prev ? tieBreak(prev, item) : item);
  }
  return [...map.values()];
}

function mergeCheckInLogs(left: CheckInLogEntry[], right: CheckInLogEntry[]): CheckInLogEntry[] {
  return mergeById(left, right, (a, b) =>
    String(a.validatedAt ?? '').localeCompare(String(b.validatedAt ?? '')) >= 0 ? a : b,
  );
}

function mergePendingCheckIns(
  left: PendingCheckInRequest[],
  right: PendingCheckInRequest[],
): PendingCheckInRequest[] {
  return mergeById(left, right, (a, b) =>
    String(a.requestedAt ?? '').localeCompare(String(b.requestedAt ?? '')) >= 0 ? a : b,
  );
}

/**
 * Une `checkInLog` e `pendingCheckIns` do snapshot em disco com o em memória,
 * para não perder entradas quando há corridas de boot ou instâncias concorrentes.
 */
export function mergeStoreOperationalData(base: ApiStore, incoming: ApiStore): ApiStore {
  return {
    ...incoming,
    checkInLog: mergeCheckInLogs(base.checkInLog ?? [], incoming.checkInLog ?? []),
    pendingCheckIns: mergePendingCheckIns(base.pendingCheckIns ?? [], incoming.pendingCheckIns ?? []),
  };
}