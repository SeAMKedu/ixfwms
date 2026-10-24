import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema.js';

export type Db = LibSQLDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Anything queries can run on: the database or an open transaction. */
export type Executor = Db | Tx;

export interface Database {
  db: Db;
  client: Client;
  close(): void;
}

export async function openDatabase(url: string): Promise<Database> {
  const client = createClient({ url });
  if (url.startsWith('file:')) {
    await client.execute('PRAGMA journal_mode = WAL');
    await client.execute('PRAGMA busy_timeout = 5000');
  }
  await client.execute('PRAGMA foreign_keys = ON');
  const db = drizzle(client, { schema });
  return { db, client, close: () => client.close() };
}

/*
 * Every Drizzle driver resolves an awaited select to its rows; only the SQLite ones add
 * `.get()` and `.all()`. Services read through these instead, so they don't depend on them.
 */

/** The first row of a query, or undefined. */
export async function one<T>(query: PromiseLike<T[]>): Promise<T | undefined> {
  return (await query)[0];
}

/** All rows of a query. */
export async function many<T>(query: PromiseLike<T[]>): Promise<T[]> {
  return query;
}
