import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';

function parseDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
  };
}

function normalizeName(name) {
  return String(name).trim().replace(/\s+/g, ' ');
}

function nameKey(name) {
  return normalizeName(name).toLowerCase();
}

function resolveCatalogFile() {
  const envPath = process.env.MODALITY_CATALOG_FILE?.trim();
  if (envPath && existsSync(envPath)) return resolve(envPath);

  const cwd = process.cwd();
  const candidates = [
    resolve(cwd, 'shared/modality_catalog_seed.json'),
    resolve(cwd, '../acaf-api/shared/modality_catalog_seed.json'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

const filePath = resolveCatalogFile();
if (!filePath) {
  console.error('modality_catalog_seed.json não encontrado');
  process.exit(1);
}

const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
const rawNames = Array.isArray(parsed.names) ? parsed.names : [];
const names = [];
const seen = new Set();
for (const raw of rawNames) {
  const normalized = normalizeName(raw);
  if (!normalized) continue;
  const key = nameKey(normalized);
  if (seen.has(key)) continue;
  seen.add(key);
  names.push(normalized);
}

if (!names.length) {
  console.error('Arquivo de catálogo sem nomes de modalidades');
  process.exit(1);
}

if (!process.env.DATABASE_URL?.trim()) {
  console.error('DATABASE_URL não definido');
  process.exit(1);
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
  CREATE TABLE IF NOT EXISTS acaf_modalities (
    id char(36) NOT NULL,
    name varchar(120) NOT NULL,
    sort_order int NOT NULL DEFAULT 0,
    active tinyint NOT NULL DEFAULT 1,
    created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY UQ_acaf_modalities_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);

const existingRows = await ds.query(
  'SELECT id, name, sort_order FROM acaf_modalities ORDER BY sort_order ASC, name ASC',
);
const byKey = new Map(existingRows.map((row) => [nameKey(row.name), row]));

const maxSort =
  existingRows.reduce((max, row) => Math.max(max, Number(row.sort_order) || 0), -1) ?? -1;

let sortCursor = maxSort;
let added = 0;
let skipped = 0;

for (const name of names) {
  const key = nameKey(name);
  if (byKey.has(key)) {
    skipped += 1;
    continue;
  }
  sortCursor += 1;
  const id = randomUUID();
  await ds.query(
    'INSERT INTO acaf_modalities (id, name, sort_order, active) VALUES (?, ?, ?, 1)',
    [id, name, sortCursor],
  );
  byKey.set(key, { id, name, sort_order: sortCursor });
  added += 1;
}

const [{ cnt }] = await ds.query('SELECT COUNT(*) AS cnt FROM acaf_modalities');

console.log(
  JSON.stringify({
    file: filePath,
    inFile: names.length,
    added,
    skipped,
    total: Number(cnt),
    fingerprint: createHash('sha256').update(names.join('\n')).digest('hex').slice(0, 12),
  }),
);

await ds.destroy();
