/**
 * Importa data/store.json (ou caminho informado) para MariaDB (acaf_partner_store + agendas).
 *
 * Uso:
 *   npm run migrate:store
 *   npm run migrate:store -- --file=/path/to/store.json
 *   npm run migrate:store -- --merge   (mescla com snapshot existente, preserva IDs novos no DB)
 */
import { config } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { parseDatabaseUrl } from '../database/parse-database-url';
import { mergeInstructorRegistry } from '../partner/instructors';
import {
  normalizeModalitySlotOverrides,
  normalizeModalitySlotTemplates,
} from '../partner/modalitySchedule';
import { PartnerStore } from '../partner/partner-store.entity';
import { normalizeStoreSnapshot } from '../partner/store-normalize';
import type { ApiStore } from '../partner/types';
import { UnitSchedule } from '../partner/unit-schedule.entity';

config();

const STORE_ID = 'main';
const DEFAULT_FILE = join(process.cwd(), 'data', 'store.json');

function parseArgs(argv: string[]) {
  let file = DEFAULT_FILE;
  let merge = false;
  for (const arg of argv) {
    if (arg === '--merge') merge = true;
    if (arg.startsWith('--file=')) file = arg.slice('--file='.length);
  }
  return { file, merge };
}

function mergeStores(db: ApiStore, local: ApiStore): ApiStore {
  const networkIds = new Set(db.networks.map((n) => n.id));
  const unitIds = new Set(db.units.map((u) => u.id));

  const networks = [...db.networks];
  for (const n of local.networks) {
    if (!networkIds.has(n.id)) {
      networks.push(n);
      networkIds.add(n.id);
    }
  }

  const units = [...db.units];
  for (const u of local.units) {
    if (!unitIds.has(u.id)) {
      units.push(u);
      unitIds.add(u.id);
    }
  }

  const studentIds = new Set(db.students.map((s) => s.id));
  const students = [...db.students];
  for (const s of local.students) {
    if (!studentIds.has(s.id)) {
      students.push(s);
      studentIds.add(s.id);
    }
  }

  const checkInIds = new Set(db.checkInLog.map((c) => c.id));
  const checkInLog = [...db.checkInLog];
  for (const c of local.checkInLog) {
    if (!checkInIds.has(c.id)) checkInLog.push(c);
  }

  return normalizeStoreSnapshot({
    ...db,
    networks,
    units,
    students,
    checkInLog,
    payoutsByUnit: { ...db.payoutsByUnit, ...local.payoutsByUnit },
    payoutHistoryByUnit: { ...db.payoutHistoryByUnit, ...local.payoutHistoryByUnit },
    issuedCodes: [...db.issuedCodes, ...local.issuedCodes.filter((c) => !db.issuedCodes.some((x) => x.code === c.code))],
    pendingCheckIns: [...db.pendingCheckIns, ...local.pendingCheckIns.filter((p) => !db.pendingCheckIns.some((x) => x.id === p.id))],
    modalityReservations: [
      ...(db.modalityReservations ?? []),
      ...(local.modalityReservations ?? []).filter(
        (r) => !(db.modalityReservations ?? []).some((x) => x.id === r.id),
      ),
    ],
    connectMembers: [
      ...(db.connectMembers ?? []),
      ...(local.connectMembers ?? []).filter(
        (m) => !(db.connectMembers ?? []).some((x) => x.holderKey === m.holderKey),
      ),
    ],
    primaryGymChanges: [
      ...(db.primaryGymChanges ?? []),
      ...(local.primaryGymChanges ?? []).filter(
        (c) => !(db.primaryGymChanges ?? []).some((x) => x.id === c.id),
      ),
    ],
    networkId: db.networkId || local.networkId,
    networkName: db.networkName || local.networkName,
    activeUnitId: db.activeUnitId || local.activeUnitId,
  });
}

async function syncUnitSchedules(ds: DataSource, store: ApiStore) {
  const repo = ds.getRepository(UnitSchedule);
  let synced = 0;
  for (const unit of store.units) {
    const templates = unit.modalitySlotTemplates ?? [];
    const overrides = unit.modalitySlotOverrides ?? [];
    if (!templates.length && !overrides.length) continue;

    const normalizedTemplates = normalizeModalitySlotTemplates(unit, templates);
    const normalizedOverrides = normalizeModalitySlotOverrides(unit, overrides);
    const instructors = mergeInstructorRegistry(unit, normalizedTemplates, normalizedOverrides);

    await repo.save(
      repo.create({
        unitId: unit.id,
        templates: normalizedTemplates,
        overrides: normalizedOverrides,
        instructors,
      }),
    );
    synced += 1;
  }
  return synced;
}

async function main() {
  const { file, merge } = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Defina DATABASE_URL no .env');
    process.exit(1);
  }
  if (!existsSync(file)) {
    console.error(`Arquivo não encontrado: ${file}`);
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(file, 'utf-8')) as ApiStore;
  const local = normalizeStoreSnapshot(raw);

  const dbConfig = parseDatabaseUrl(databaseUrl);
  const ssl =
    process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined;

  const ds = new DataSource({
    type: 'mariadb',
    host: dbConfig.host,
    port: dbConfig.port,
    username: dbConfig.username,
    password: dbConfig.password,
    database: dbConfig.database,
    entities: [PartnerStore, UnitSchedule],
    synchronize: true,
    ssl,
  });

  await ds.initialize();
  const storeRepo = ds.getRepository(PartnerStore);

  const existing = await storeRepo.findOne({ where: { id: STORE_ID } });
  let finalStore: ApiStore;

  if (existing?.data && merge) {
    finalStore = mergeStores(normalizeStoreSnapshot(existing.data), local);
    console.log('Modo merge: combinando store local com snapshot do MariaDB.');
  } else {
    finalStore = local;
    console.log('Modo replace: store local substitui snapshot no MariaDB.');
  }

  await storeRepo.save(storeRepo.create({ id: STORE_ID, data: finalStore }));

  const schedules = await syncUnitSchedules(ds, finalStore);

  console.log(
    `OK — MariaDB atualizado: ${finalStore.networks.length} rede(s), ${finalStore.units.length} unidade(s), ${finalStore.students.length} aluno(s), ${finalStore.checkInLog.length} check-in(s), ${schedules} agenda(s).`,
  );
  console.log(`Redes: ${finalStore.networks.map((n) => n.name).join(', ')}`);

  await ds.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
