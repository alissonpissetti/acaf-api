import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiStore } from './types';
import { createEmptyStore, normalizeStoreSnapshot } from './store-normalize';
import { mergeStoreOperationalData } from './store-merge';

const DOMAIN_PATH = join(process.cwd(), 'shared', 'connect_domain.json');

export interface StoreBackend {
  isReady(): boolean;
  getStore(): ApiStore;
  setStore(store: ApiStore): void;
}

let backend: StoreBackend | null = null;
let memoryCache: ApiStore = createEmptyStore();
let storeReadyPromise: Promise<void> | null = null;
let storeReadyResolve: (() => void) | null = null;

export function registerStoreBackend(next: StoreBackend) {
  const fromBackend = normalizeStoreSnapshot(structuredClone(next.getStore()));
  const merged = normalizeStoreSnapshot(mergeStoreOperationalData(fromBackend, memoryCache));
  backend = next;
  memoryCache = merged;
  const operationalChanged =
    JSON.stringify(merged.checkInLog) !== JSON.stringify(fromBackend.checkInLog) ||
    JSON.stringify(merged.pendingCheckIns) !== JSON.stringify(fromBackend.pendingCheckIns);
  if (operationalChanged) {
    next.setStore(merged);
  }
  if (storeReadyResolve) {
    storeReadyResolve();
    storeReadyResolve = null;
    storeReadyPromise = null;
  }
}

export function whenStoreReady(): Promise<void> {
  if (backend?.isReady()) return Promise.resolve();
  if (!storeReadyPromise) {
    storeReadyPromise = new Promise<void>((resolve) => {
      storeReadyResolve = resolve;
    });
  }
  return storeReadyPromise;
}

export function getDomain() {
  return JSON.parse(readFileSync(DOMAIN_PATH, 'utf-8'));
}

export function loadStore(): ApiStore {
  if (backend?.isReady()) {
    return backend.getStore();
  }
  return memoryCache;
}

export function saveStore(store: ApiStore) {
  const normalized = normalizeStoreSnapshot(structuredClone(store));
  memoryCache = normalized;
  if (backend?.isReady()) {
    backend.setStore(normalized);
  }
}

export function saveDomain(domain: Record<string, unknown>) {
  writeFileSync(DOMAIN_PATH, JSON.stringify(domain, null, 2), 'utf-8');
}

export function updateStore(mutator: (draft: ApiStore) => void): ApiStore {
  const store = structuredClone(loadStore());
  mutator(store);
  saveStore(store);
  return store;
}

/** Só persiste se `mutator` retornar true (evita writes redundantes no MariaDB). */
export function updateStoreIf(mutator: (draft: ApiStore) => boolean): ApiStore | null {
  const store = structuredClone(loadStore());
  const changed = mutator(store);
  if (!changed) return null;
  saveStore(store);
  return store;
}
