import { isValidCode, normalizeCode } from '@ixfwms/domain';
import { eq } from 'drizzle-orm';
import { one, type Db, type Executor } from '../../db/client.js';
import { parts } from '../../db/schema.js';
import { notFound } from '../../lib/errors.js';

export type PartRow = typeof parts.$inferSelect;

/** Finds parts by id or code. Shared by services that only need lookups. */
export class PartResolver {
  constructor(private readonly db: Db) {}

  async resolve(ref: string, ex: Executor = this.db): Promise<PartRow> {
    const code = normalizeCode(ref);
    const row = isValidCode(code)
      ? await one(ex.select().from(parts).where(eq(parts.code, code)))
      : undefined;
    const found = row ?? (await one(ex.select().from(parts).where(eq(parts.id, ref))));
    if (!found) throw notFound('part', ref);
    return found;
  }
}
