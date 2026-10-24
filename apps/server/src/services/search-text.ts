import { fold } from '@ixfwms/domain';
import { isNull, sql, eq, type AnyColumn, type SQL } from 'drizzle-orm';
import { many, type Executor } from '../db/client.js';
import { parts, units } from '../db/schema.js';

type PartText = Pick<
  typeof parts.$inferSelect,
  'name' | 'description' | 'manufacturer' | 'aliases'
>;
type UnitText = Pick<typeof units.$inferSelect, 'name' | 'serialNo'>;

/** What search finds a part by, folded: its name, description, maker and aliases. */
export const partSearchText = (p: PartText): string =>
  fold([p.name, p.description, p.manufacturer, ...p.aliases].filter(Boolean).join('\n'));

/** What search finds a unit by, folded: its own name and serial number (its code is matched exactly). */
export const unitSearchText = (u: UnitText): string =>
  fold([u.name, u.serialNo].filter(Boolean).join('\n'));

/** `column` (already folded) contains `text`; % and _ in the text match only themselves. */
export function contains(column: AnyColumn, text: string): SQL {
  const escaped = fold(text).replace(/[\\%_]/g, (c) => `\\${c}`);
  return sql`${column} like ${`%${escaped}%`} escape '\\'`;
}

/** Fills search text that is missing: rows from before migration 0015. Cheap when there are none. */
export async function fillSearchText(ex: Executor): Promise<void> {
  for (const p of await many(ex.select().from(parts).where(isNull(parts.searchText))))
    await ex
      .update(parts)
      .set({ searchText: partSearchText(p) })
      .where(eq(parts.id, p.id));
  for (const u of await many(ex.select().from(units).where(isNull(units.searchText))))
    await ex
      .update(units)
      .set({ searchText: unitSearchText(u) })
      .where(eq(units.id, u.id));
}
