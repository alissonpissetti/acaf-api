import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ApiStore } from './types';
import { createEmptyStore, normalizeStoreSnapshot } from './store-normalize';

const STORE_PATH = join(process.cwd(), 'data', 'store.json');
const DOMAIN_PATH = join(process.cwd(), 'shared', 'connect_domain.json');

export interface StoreBackend {
  isReady(): boolean;
  getStore(): ApiStore;
  setStore(store: ApiStore): void;
}

let backend: StoreBackend | null = null;
let fileCache: ApiStore | null = null;
let fileCacheMtime = 0;
let storeReadyPromise: Promise<void> | null = null;
let storeReadyResolve: (() => void) | null = null;

export function registerStoreBackend(next: StoreBackend) {
  backend = next;
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

function loadStoreFromFile(): ApiStore {
  if (existsSync(STORE_PATH)) {
    const mtime = statSync(STORE_PATH).mtimeMs;
    if (fileCache && mtime === fileCacheMtime) return fileCache;
    const raw = JSON.parse(readFileSync(STORE_PATH, 'utf-8')) as ApiStore;
    fileCache = normalizeStoreSnapshot(raw);
    fileCacheMtime = mtime;
    return fileCache;
  }
  if (fileCache) return fileCache;
  fileCache = createEmptyStore();
  return fileCache;
}

export function loadStore(): ApiStore {
  if (backend?.isReady()) {
    return backend.getStore();
  }
  return loadStoreFromFile();
}

export function saveStore(store: ApiStore) {
  const normalized = normalizeStoreSnapshot(structuredClone(store));
  if (backend?.isReady()) {
    backend.setStore(normalized);
    return;
  }
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(normalized, null, 2), 'utf-8');
  fileCache = normalized;
  fileCacheMtime = existsSync(STORE_PATH) ? statSync(STORE_PATH).mtimeMs : 0;
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
