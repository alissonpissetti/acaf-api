import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

function parseDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  const protocol = url.protocol.replace(':', '');
  return {
    type: protocol === 'postgres' ? 'postgres' : 'mysql',
    host: url.hostname,
    port: Number(url.port || 3306),
    username: decodeURIComponent(url.username),
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
});

await ds.initialize();

await ds.query(`
  CREATE TABLE IF NOT EXISTS acaf_system_settings (
    \`key\` varchar(80) NOT NULL,
    \`value\` text NOT NULL,
    \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (\`key\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);

const domain = JSON.parse(
  readFileSync(join(process.cwd(), 'shared/connect_domain.json'), 'utf8'),
);

const seeds = [
  ['connectFeePercent', String(domain.connectFeePercent ?? 20)],
  ['dailyFeePercent', String(domain.dailyFeePercent ?? domain.connectFeePercent ?? 20)],
  ['evolutionApiBaseUrl', String(domain.evolutionApiBaseUrl ?? '').trim()],
  ['evolutionApiKey', String(domain.evolutionApiKey ?? '').trim()],
];

for (const [key, value] of seeds) {
  const existing = await ds.query('SELECT `key` FROM acaf_system_settings WHERE `key` = ?', [key]);
  if (existing.length) continue;
  const isFee = key === 'connectFeePercent' || key === 'dailyFeePercent';
  if (!isFee && !value) continue;
  await ds.query('INSERT INTO acaf_system_settings (`key`, `value`) VALUES (?, ?)', [key, value]);
}

const rows = await ds.query(
  'SELECT `key`, LENGTH(`value`) AS value_length, updated_at FROM acaf_system_settings ORDER BY `key`',
);
console.log('acaf_system_settings:', rows);
await ds.destroy();
