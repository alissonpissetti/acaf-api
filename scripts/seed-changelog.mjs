import 'dotenv/config';
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

function resolveChangelogFile() {
  const envPath = process.env.CHANGELOG_FILE?.trim();
  if (envPath && existsSync(envPath)) return resolve(envPath);

  const cwd = process.cwd();
  const candidates = [
    resolve(cwd, 'changelog/changelog.json'),
    resolve(cwd, '../changelog/changelog.json'),
    resolve(cwd, '../../changelog/changelog.json'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function sortOrder(committedAt) {
  const ms = new Date(committedAt).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

function normalizeRaw(entry) {
  const sha = String(entry.commitSha ?? '').trim() || null;
  const repo =
    String(entry.repository ?? '').trim() ||
    (Array.isArray(entry.areas) && entry.areas.length === 1 ? entry.areas[0] : null) ||
    null;
  const id =
    String(entry.id ?? '').trim() ||
    (sha ? `changelog:${repo ?? 'unknown'}:${sha}` : `changelog:${Date.now()}`);
  const highlights = (entry.highlights ?? []).map((l) => String(l).trim()).filter(Boolean);

  return {
    id,
    commit_sha: sha,
    repository: repo,
    source: entry.source === 'git' ? 'git' : 'changelog',
    committed_at: new Date(entry.committedAt),
    title: String(entry.title ?? '').trim() || 'Atualização',
    summary: entry.summary?.trim() || null,
    category: entry.category ?? 'maintenance',
    areas: JSON.stringify(
      Array.isArray(entry.areas) ? entry.areas.map((a) => String(a).trim()).filter(Boolean) : [],
    ),
    highlights: highlights.length ? JSON.stringify(highlights) : null,
    author: entry.author?.trim() || null,
    audience: entry.audience ?? 'internal',
    published: entry.published !== false ? 1 : 0,
    sort_order: sortOrder(entry.committedAt),
  };
}

async function findExisting(ds, raw) {
  if (raw.commit_sha) {
    if (raw.repository) {
      const rows = await ds.query(
        'SELECT id FROM acaf_changelog_entries WHERE commit_sha = ? AND repository = ? LIMIT 1',
        [raw.commit_sha, raw.repository],
      );
      if (rows.length) return rows[0].id;
    }
    const rows = await ds.query(
      'SELECT id FROM acaf_changelog_entries WHERE commit_sha = ? LIMIT 1',
      [raw.commit_sha],
    );
    if (rows.length) return rows[0].id;
  }
  const rows = await ds.query('SELECT id FROM acaf_changelog_entries WHERE id = ? LIMIT 1', [raw.id]);
  return rows.length ? rows[0].id : null;
}

async function upsert(ds, raw) {
  const existingId = await findExisting(ds, raw);
  const cols = [
    'commit_sha',
    'repository',
    'source',
    'committed_at',
    'title',
    'summary',
    'category',
    'areas',
    'highlights',
    'author',
    'audience',
    'published',
    'sort_order',
  ];
  const vals = cols.map((c) => raw[c]);

  if (existingId) {
    const set = cols.map((c) => `\`${c}\` = ?`).join(', ');
    await ds.query(`UPDATE acaf_changelog_entries SET ${set} WHERE id = ?`, [...vals, existingId]);
    return false;
  }

  await ds.query(
    `INSERT INTO acaf_changelog_entries (id, ${cols.map((c) => `\`${c}\``).join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
    [raw.id, ...vals],
  );
  return true;
}

const filePath = resolveChangelogFile();
if (!filePath) {
  console.error('changelog.json não encontrado');
  process.exit(1);
}

const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
if (!entries.length) {
  console.error('changelog.json sem entradas');
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

let added = 0;
for (const entry of entries) {
  const raw = normalizeRaw(entry);
  if (await upsert(ds, raw)) added += 1;
}

const [{ cnt }] = await ds.query('SELECT COUNT(*) AS cnt FROM acaf_changelog_entries');
console.log(
  JSON.stringify({
    file: filePath,
    fromFile: entries.length,
    added,
    total: Number(cnt),
  }),
);

await ds.destroy();

if (Number(cnt) < entries.length) {
  console.warn(
    `Aviso: total no banco (${cnt}) menor que entradas no JSON (${entries.length}) — pode haver duplicatas por SHA agrupando linhas.`,
  );
  process.exit(0);
}
