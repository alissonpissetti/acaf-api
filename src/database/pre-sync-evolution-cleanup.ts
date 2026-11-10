import { createConnection, type Connection } from 'mysql2/promise';
import { parseDatabaseUrl } from './parse-database-url';

async function tableExists(conn: Connection, table: string): Promise<boolean> {
  const [rows] = await conn.query(`SHOW TABLES LIKE '${table.replace(/'/g, "''")}'`);
  return Array.isArray(rows) && rows.length > 0;
}

/**
 * Antes do TypeORM `synchronize`, remove perfis Evolution inválidos/duplicados
 * que impedem o índice único (instance_id + contact_key).
 */
export async function cleanupEvolutionContactProfilesForSync(): Promise<void> {
  const syncEnabled = (process.env.DB_SYNC ?? 'true') === 'true';
  if (!syncEnabled) return;

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return;

  const db = parseDatabaseUrl(databaseUrl);
  const sslEnabled = process.env.DATABASE_SSL !== 'false';

  const conn = await createConnection({
    host: db.host,
    port: db.port,
    user: db.username,
    password: db.password,
    database: db.database,
    ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
  });

  try {
    if (!(await tableExists(conn, 'acaf_evolution_contact_profiles'))) return;

    await conn.execute(
      `DELETE FROM acaf_evolution_contact_profiles
       WHERE contact_key IS NULL
          OR TRIM(contact_key) = ''
          OR contact_key IN ('unknown', '-')`,
    );

    await conn.execute(
      `DELETE p1 FROM acaf_evolution_contact_profiles p1
       INNER JOIN acaf_evolution_contact_profiles p2
         ON p1.instance_id = p2.instance_id
        AND p1.contact_key = p2.contact_key
        AND p1.id > p2.id`,
    );

    if (await tableExists(conn, 'acaf_evolution_messages')) {
      await conn.execute(
        `DELETE FROM acaf_evolution_messages
         WHERE contact_phone IS NULL
            OR TRIM(contact_phone) = ''
            OR contact_phone IN ('unknown', '-')`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[pre-sync] Limpeza acaf_evolution_contact_profiles: ${message}`);
  } finally {
    await conn.end();
  }
}
