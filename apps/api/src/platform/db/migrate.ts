/* Minimal SQL migration runner: applies src/platform/db/migrations/*.sql in
 * filename order, each inside a transaction, tracked in schema_migrations. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';
import { databaseUrl } from './db.service';

export async function runMigrations(pool: Pool): Promise<string[]> {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const dir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied: string[] = [];
  for (const file of files) {
    const seen = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (seen.rowCount) continue;

    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}

if (require.main === module) {
  const pool = new Pool({ connectionString: databaseUrl() });
  runMigrations(pool)
    .then((applied) => {
      console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date');
      return pool.end();
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
