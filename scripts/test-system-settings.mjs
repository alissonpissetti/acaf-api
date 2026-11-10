import 'dotenv/config';
import { DataSource } from 'typeorm';

const testUrl = 'http://evo-fbyctrcuquuy99ixfbrvwxn8.187.53.99.12.sslip.io';

function parseDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  return {
    type: url.protocol.replace(':', '') === 'postgres' ? 'postgres' : 'mysql',
    host: url.hostname,
    port: Number(url.port || 3306),
    username: url.username,
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
  };
}

const db = parseDatabaseUrl(process.env.DATABASE_URL);
const ds = new DataSource({
  type: 'mysql',
  host: db.host,
  port: db.port,
  username: db.username,
  password: db.password,
  database: db.database,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities: [
    {
      name: 'SystemSetting',
      tableName: 'acaf_system_settings',
      columns: {
        key: { type: 'varchar', length: 80, primary: true },
        value: { type: 'text' },
      },
    },
  ],
  synchronize: false,
});

await ds.initialize();
const repo = ds.getRepository('SystemSetting');
await repo.save({ key: 'evolutionApiBaseUrl', value: testUrl });
const row = await repo.findOne({ where: { key: 'evolutionApiBaseUrl' } });
console.log(row?.value === testUrl ? 'TYPEORM_SAVE_OK' : 'TYPEORM_SAVE_FAIL', row?.value);
await ds.destroy();
