/**
 * Define Unidade Batel (Carpe Diem) como academia principal dos assinantes Connect
 * e restaura extrato financeiro da unidade no MariaDB.
 *
 * Uso:
 *   npm run seed:batel-primary
 *   npm run seed:batel-primary -- --file=data/store.json
 */
import { config } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { parseDatabaseUrl } from '../database/parse-database-url';
import { PartnerStore } from '../partner/partner-store.entity';
import {
  applyCarpeBatelPrimaryScenario,
  CARPE_BATEL_UNIT_ID,
} from '../partner/primaryGymSeed';
import { normalizeStoreSnapshot } from '../partner/store-normalize';
import type { ApiStore, MonthlyPayout } from '../partner/types';
import { UnitSchedule } from '../partner/unit-schedule.entity';

config();

const STORE_ID = 'main';
const DEFAULT_FILE = join(process.cwd(), 'data', 'store.json');

function parseArgs(argv: string[]) {
  let file = DEFAULT_FILE;
  for (const arg of argv) {
    if (arg.startsWith('--file=')) file = arg.slice('--file='.length);
  }
  return { file };
}

async function main() {
  const { file } = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Defina DATABASE_URL no .env');
    process.exit(1);
  }

  let payoutHistory: MonthlyPayout[] | undefined;
  if (existsSync(file)) {
    const local = normalizeStoreSnapshot(
      JSON.parse(readFileSync(file, 'utf-8')) as ApiStore,
    );
    payoutHistory = local.payoutHistoryByUnit?.[CARPE_BATEL_UNIT_ID];
    if (payoutHistory?.length) {
      console.log(
        `Extrato Batel em ${file}: ${payoutHistory.length} mês(es) — ${payoutHistory.map((p) => p.monthLabel).join(', ')}`,
      );
    }
  } else {
    console.warn(`Arquivo não encontrado (${file}); só academia principal será atualizada.`);
  }

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
  if (!existing?.data) {
    console.error('Store vazio no MariaDB. Rode npm run migrate:store primeiro.');
    await ds.destroy();
    process.exit(1);
  }

  const store = normalizeStoreSnapshot(existing.data);
  const result = applyCarpeBatelPrimaryScenario(store, { payoutHistory });

  await storeRepo.save(storeRepo.create({ id: STORE_ID, data: store }));

  console.log(
    `OK — ${result.unitName} (${result.unitId}): ${result.membersAssigned} associado(s) atualizado(s), ${result.membersCreated} criado(s), ${result.payoutMonthsRestored} mês(es) de extrato.`,
  );
  console.log(
    `Connect members com Batel principal: ${
      (store.connectMembers ?? []).filter((m) => m.primaryUnitId === CARPE_BATEL_UNIT_ID).length
    }`,
  );

  await ds.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
