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
