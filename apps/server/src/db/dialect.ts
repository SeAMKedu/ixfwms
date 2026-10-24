import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

/*
 * The SQL that differs between SQLite and Postgres. Services build queries with Drizzle and
 * SQL both understand (lower, substr, ||, coalesce, cast, exists, count); what is specific to
 * one database goes here, so moving to Postgres changes this file, the schema, the migrations
 * and the backups (see PLAN.md, "Database portability"), not the services.
 */

/** A value inside a JSON column, e.g. jsonValue(parts.attributes, ['colour', 'name']). Postgres: `col #>> '{colour,name}'`. */
export function jsonValue(column: AnyColumn, path: string[]): SQL {
  return sql`json_extract(${column}, ${`$.${path.join('.')}`})`;
}

/** The current time as ISO-8601 UTC text, for column defaults. Postgres: `to_char(now() at time zone 'utc', …)`. */
export const nowIsoDefault = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

/**
 * Which of the database's own rules an error broke: a unique index, or the code triggers of
 * migration 0013 (their message). Null for any other error. Postgres: SQLSTATE 23505, and the
 * trigger functions raise the same message.
 */
export function brokenRule(err: unknown): 'unique' | 'code' | null {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if (e.message.includes('code is already in use or retired')) return 'code';
    const code = (e as { code?: unknown }).code;
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || e.message.includes('UNIQUE constraint failed'))
      return 'unique';
  }
  return null;
}
