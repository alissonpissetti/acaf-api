import { existsSync, readFileSync } from 'node:fs';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { join } from 'node:path';
import { PartnerStore } from './partner-store.entity';
import { registerStoreBackend, type StoreBackend } from './store';
import type { ApiStore } from './types';
import { createEmptyStore, normalizeStoreSnapshot } from './store-normalize';

const STORE_ID = 'main';
const LEGACY_STORE_PATH = join(process.cwd(), 'data', 'store.json');

@Injectable()
export class PartnerStorePersistenceService implements OnModuleInit, StoreBackend {
  private readonly logger = new Logger(PartnerStorePersistenceService.name);
  private store: ApiStore = createEmptyStore();
  private ready = false;
  private readyPromise: Promise<void> | null = null;
  private saving = false;
  private pendingSave: ApiStore | null = null;

  constructor(
    @InjectRepository(PartnerStore)
    private readonly repo: Repository<PartnerStore>,
  ) {}

  async onModuleInit() {
    this.readyPromise = this.bootstrap();
    await this.readyPromise;
    this.ready = true;
    registerStoreBackend(this);
  }

  async whenReady(): Promise<void> {
    if (this.ready) return;
    if (this.readyPromise) await this.readyPromise;
  }

  isReady(): boolean {
    return this.ready;
  }

  getStore(): ApiStore {
    return this.store;
  }

  setStore(store: ApiStore): void {
    this.store = store;
    this.schedulePersist(store);
  }

  private async bootstrap() {
    const row = await this.repo.findOne({ where: { id: STORE_ID } });
    if (row?.data) {
      const hasNetworks = (row.data.networks?.length ?? 0) > 0 || (row.data.units?.length ?? 0) > 0;
      if (hasNetworks) {
        this.store = normalizeStoreSnapshot(row.data);
        this.logger.log('Store operacional carregado do MariaDB.');
        return;
      }
      if (existsSync(LEGACY_STORE_PATH)) {
        this.logger.warn('Snapshot MariaDB vazio; tentando migrar data/store.json legado.');
      } else {
        this.store = normalizeStoreSnapshot(row.data);
        this.logger.log('Store operacional carregado do MariaDB.');
        return;
      }
    }

    if (existsSync(LEGACY_STORE_PATH)) {
      try {
        const raw = JSON.parse(readFileSync(LEGACY_STORE_PATH, 'utf-8')) as ApiStore;
        this.store = normalizeStoreSnapshot(raw);
        await this.repo.save(this.repo.create({ id: STORE_ID, data: this.store }));
        this.logger.log('Store migrado de data/store.json para MariaDB.');
        return;
      } catch (err) {
        this.logger.error('Falha ao migrar store.json; iniciando store vazio.', err);
      }
    }

    this.store = createEmptyStore();
    await this.repo.save(this.repo.create({ id: STORE_ID, data: this.store }));
    this.logger.log('Store operacional vazio criado no MariaDB.');
  }

  private schedulePersist(store: ApiStore) {
    this.pendingSave = structuredClone(store);
    void this.flushPersist();
  }

  private async flushPersist() {
    if (this.saving) return;
    this.saving = true;
    try {
      while (this.pendingSave) {
        const snapshot = this.pendingSave;
        this.pendingSave = null;
        await this.repo.save(this.repo.create({ id: STORE_ID, data: snapshot }));
      }
    } catch (err) {
      this.logger.error('Falha ao persistir store no MariaDB', err);
    } finally {
      this.saving = false;
      if (this.pendingSave) void this.flushPersist();
    }
  }
}
