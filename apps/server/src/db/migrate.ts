import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/libsql/migrator';
import type { Database } from './client.js';

/** Works from both src/db (tsx) and dist/db (compiled): migrations live in apps/server/drizzle. */
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

export async function pendingMigrations(database: Database): Promise<number> {
  const journal = JSON.parse(
    await readFile(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
  ) as {
    entries: unknown[];
  };
  const table = await database.client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
  );
  if (table.rows.length === 0) return journal.entries.length;
  const applied = await database.client.execute('SELECT count(*) AS n FROM __drizzle_migrations');
  return journal.entries.length - Number(applied.rows[0]?.n ?? 0);
}

export async function runMigrations(database: Database): Promise<void> {
  await migrate(database.db, { migrationsFolder: MIGRATIONS_DIR });
}
