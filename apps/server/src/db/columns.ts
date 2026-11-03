import { text } from 'drizzle-orm/sqlite-core';
import { nowIso } from '../lib/ids.js';
import { nowIsoDefault } from './dialect.js';

export const id = () => text('id').primaryKey();
/** The time a row was written. The app sets it (nowIso: one fixed-width form); the SQL default is for raw SQL. */
export const writtenAt = (name: string) =>
  text(name).notNull().default(nowIsoDefault).$defaultFn(nowIso);
export const createdAt = () => writtenAt('created_at');
export const updatedAt = () => writtenAt('updated_at');
