/**
 * Exclusão definitiva de landing page direto no banco (emergência).
 * Uso: DATABASE_URL=... node scripts/force-delete-landing-page.mjs <id-uuid | slug>
 */
import 'dotenv/config';
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

const target = process.argv[2]?.trim();
if (!target) {
  console.error('Uso: npm run force-delete-landing-page -- <id-uuid | slug>');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('Defina DATABASE_URL no ambiente.');
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

const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
  target,
);
const rows = await ds.query(
  isUuid
    ? `SELECT id, slug, name, active, creative_id FROM acaf_marketing_landing_pages WHERE id = ? LIMIT 1`
    : `SELECT id, slug, name, active, creative_id FROM acaf_marketing_landing_pages WHERE slug = ? LIMIT 1`,
  [target],
);

const page = Array.isArray(rows) ? rows[0] : rows;
if (!page?.id) {
  console.error(`Nenhum formulário encontrado para: ${target}`);
  await ds.destroy();
  process.exit(1);
}

console.log(`Removendo definitivamente: ${page.name} (${page.slug}) id=${page.id}`);

const queryRunner = ds.createQueryRunner();
await queryRunner.connect();
await queryRunner.startTransaction();
try {
  await queryRunner.query(
    `UPDATE acaf_marketing_creatives SET landing_page_id = NULL WHERE landing_page_id = ?`,
    [page.id],
  );
  if (page.creative_id) {
    await queryRunner.query(
      `UPDATE acaf_marketing_creatives SET landing_page_id = NULL WHERE id = ?`,
      [page.creative_id],
    );
  }
  await queryRunner.query(`DELETE FROM acaf_marketing_page_events WHERE landing_page_id = ?`, [
    page.id,
  ]);
  await queryRunner.query(`DELETE FROM acaf_marketing_form_submissions WHERE landing_page_id = ?`, [
    page.id,
  ]);
  const del = await queryRunner.query(`DELETE FROM acaf_marketing_landing_pages WHERE id = ?`, [
    page.id,
  ]);
  await queryRunner.commitTransaction();
  const affected =
    del?.affectedRows ?? (Array.isArray(del) ? Number(del[0]?.affectedRows ?? 0) : 0);
  if (affected > 0) {
    console.log('OK — formulário removido do banco.');
  } else {
    console.error('DELETE não afetou linhas; verifique permissões e id.');
    process.exitCode = 1;
  }
} catch (error) {
  await queryRunner.rollbackTransaction();
  console.error('Falha:', error);
  process.exitCode = 1;
} finally {
  await queryRunner.release();
  await ds.destroy();
}
