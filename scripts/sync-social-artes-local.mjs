#!/usr/bin/env node
/**
 * Copia assets → files/ e atualiza url_publica no MySQL (sem subir o Nest).
 * Lê .env.local na pasta acaf-api.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { config } from 'dotenv';
import mysql from 'mysql2/promise';

const ROOT = process.cwd();
config({ path: join(ROOT, '.env.local') });
config({ path: join(ROOT, '.env') });

const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL) {
  console.error('DATABASE_URL não definido (.env.local)');
  process.exit(1);
}

const storageRoot = process.env.SOCIAL_POST_STORAGE_DIR?.trim()
  ? process.env.SOCIAL_POST_STORAGE_DIR.replace(/\/$/, '')
  : join(ROOT, 'storage/social-posts');

const assetsDir = join(storageRoot, 'assets');
const filesDir = join(storageRoot, 'files');
const port = process.env.PORT ?? '8787';
const apiBase = (
  process.env.API_PUBLIC_URL?.trim() ||
  process.env.ACAF_API_PUBLIC_URL?.trim() ||
  `http://127.0.0.1:${port}`
).replace(/\/$/, '');

const ASSET_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

function findSeedAssetPath(postCodigo, nome, driveId) {
  const code = String(postCodigo ?? '').trim().toLowerCase();
  if (!code) return null;
  const folder = join(assetsDir, code);
  if (!existsSync(folder)) return null;

  const names = new Set();
  if (nome?.trim()) {
    names.add(nome.trim());
    names.add(nome.trim().toUpperCase());
    names.add(nome.trim().toLowerCase());
  }
  if (driveId?.trim()) names.add(driveId.trim());

  for (const base of names) {
    for (const ext of ASSET_EXTENSIONS) {
      const full = join(folder, `${base}${ext}`);
      if (existsSync(full)) return full;
    }
  }

  const files = readdirSync(folder).filter((f) =>
    ASSET_EXTENSIONS.includes(extname(f).toLowerCase()),
  );
  if (files.length === 1) return join(folder, files[0]);
  return null;
}

function parseDbUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

async function main() {
  mkdirSync(filesDir, { recursive: true });
  const conn = await mysql.createConnection(parseDbUrl(DATABASE_URL));

  await conn.query(
    `UPDATE acaf_social_post_artes SET url_publica = NULL
     WHERE url_publica LIKE '%googleusercontent%' OR url_publica LIKE '%drive.google%'`,
  );

  const [rows] = await conn.query(
    `SELECT a.id, a.nome, a.drive_id AS driveId, a.arquivo, p.codigo
     FROM acaf_social_post_artes a
     INNER JOIN acaf_social_posts p ON p.id = a.post_id`,
  );

  let linked = 0;
  let missing = 0;

  for (const row of rows) {
    const source = findSeedAssetPath(row.codigo, row.nome, row.driveId);
    if (!source) {
      missing++;
      continue;
    }
    const ext = extname(source).toLowerCase() || '.png';
    const relative = `files/${row.id}${ext}`;
    const dest = join(storageRoot, relative);
    copyFileSync(source, dest);
    const publicUrl = `${apiBase}/api/social-posts/media/${row.id}`;
    await conn.query(
      `UPDATE acaf_social_post_artes SET arquivo = ?, url_publica = ? WHERE id = ?`,
      [relative, publicUrl, row.id],
    );
    linked++;
  }

  await conn.end();
  console.log(`✓ ${linked} arte(s) sincronizada(s) → files/ + banco`);
  if (missing) console.log(`⚠ ${missing} arte(s) no banco sem PNG em assets/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});