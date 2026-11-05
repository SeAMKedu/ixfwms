import type { WriteOffRow } from '@ixfwms/domain';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { many, type Db } from '../db/client.js';
import { parts, unitEvents, units } from '../db/schema.js';
import { requireScope, type Actor } from '../lib/context.js';
import { purchaseOf } from './unit-views.js';

const REMOVED = ['archived', 'lost'];

/**
 * The list finance asks for ("poistolista"), for working out depreciation: tools and devices with
 * purchase details, or that have been removed from use, with when (from the unit's log).
 */
export class WriteOffService {
  constructor(private readonly db: Db) {}

  async list(actor: Actor | null): Promise<WriteOffRow[]> {
    requireScope(actor, 'inventory');
    const rows = await many(
      this.db
        .select({ unit: units, part: parts.name })
        .from(units)
        .innerJoin(parts, eq(parts.id, units.partId)),
    );
    const removals = await many(
      this.db
        .select({ unitId: unitEvents.unitId, value: unitEvents.value, at: unitEvents.at })
        .from(unitEvents)
        .where(and(eq(unitEvents.kind, 'status'), inArray(unitEvents.value, REMOVED)))
        .orderBy(desc(unitEvents.at)),
    );
    const removedAt = (id: string, status: string) =>
      removals.find((r) => r.unitId === id && r.value === status)?.at ?? null;
    return rows
      .filter(
        ({ unit: u }) =>
          REMOVED.includes(u.status) ||
          u.purchaseDate ||
          u.purchaseValueCents != null ||
          u.costCenter ||
          u.usefulLifeYears != null,
      )
      .map(({ unit: u, part }) => ({
        code: u.code,
        name: u.name ?? `${part} ${u.code}`,
        serialNo: u.serialNo,
        status: u.status,
        purchase: purchaseOf(u),
        removedAt: REMOVED.includes(u.status) ? removedAt(u.id, u.status) : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
