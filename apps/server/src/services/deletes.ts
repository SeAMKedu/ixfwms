import { and, count, eq, like, type SQL } from 'drizzle-orm';
import { one, type Db, type Executor } from '../db/client.js';
import {
  attachments,
  locationMoves,
  locations,
  loans,
  parts,
  reports,
  stockLots,
  stockMovements,
  units,
  users,
} from '../db/schema.js';
import { invalid } from '../lib/errors.js';
import { retireCode } from './codes.js';
import { audit, requireScope, type Actor } from '../lib/context.js';
import { checkNotLent } from '../modules/loans/rules.js';
import type { LocationService } from './locations.js';
import type { PartResolver } from './parts.js';
import type { StockService } from './stock.js';
import type { UnitService } from './units.js';

/**
 * Deleting completely: the thing, its stock, files and history. Only while it isn't in use
 * (built into something, lent out, holding things); what should stay on record is archived,
 * retired or dismantled instead. The code is retired, since a label may have
 * been printed: scanning it says what was deleted. The change log keeps one line.
 */
export class DeleteService {
  constructor(
    private readonly db: Db,
    private readonly resolver: PartResolver,
    private readonly locations: LocationService,
    private readonly stock: StockService,
    private readonly units: UnitService,
  ) {}

  /**
   * An item that isn't in use: nothing of it built into anything and no unit lent out (a lent
   * unit marked lost may go). Its units go with it.
   */
  async part(ref: string, actor: Actor | null): Promise<void> {
    const who = requireScope(actor, 'write');
    await this.db.transaction(async (tx) => {
      const part = await this.resolver.resolve(ref, tx);
      const rows = await tx.select().from(units).where(eq(units.partId, part.id));
      const briefs = await this.units.briefs(rows, tx);
      if (
        (await this.stock.lotsOfPart(part.id, tx)).some((l) => l.location.inBuild) ||
        briefs.some((b) => b.location.inBuild)
      )
        throw invalid('delete.inBuild', { name: part.name });
      const lent = briefs.find((b) => b.loan && b.status !== 'lost');
      if (lent) throw invalid('delete.unitLent', { name: part.name, unit: lent.name });
      for (const [i, unit] of rows.entries()) await this.dropUnit(tx, unit, briefs[i]!.name);
      await tx.delete(stockLots).where(eq(stockLots.partId, part.id));
      await tx.delete(stockMovements).where(eq(stockMovements.partId, part.id));
      await this.dropOwned(tx, 'part', part.id);
      await retireCode(tx, part.code, `deleted item ${part.name}`);
      await tx.delete(parts).where(eq(parts.id, part.id));
      await audit(tx, who, 'delete', 'part', part.id, { code: part.code, name: part.name });
    });
  }

  /** A unit that isn't built into anything or lent out (one lent and then marked lost may go). */
  async unit(ref: string, actor: Actor | null): Promise<void> {
    const who = requireScope(actor, 'write');
    await this.db.transaction(async (tx) => {
      const unit = await this.units.resolve(ref, tx);
      const [brief] = await this.units.briefs([unit], tx);
      if (brief!.location.inBuild) throw invalid('delete.inBuild', { name: brief!.name });
      if (brief!.loan && unit.status !== 'lost')
        throw invalid('delete.lent', { name: brief!.name });
      await this.dropUnit(tx, unit, brief!.name);
      await audit(tx, who, 'delete', 'unit', unit.id, { code: unit.code, name: brief!.name });
    });
  }

  /** The unit with its loans, files and reports; its log cascades (unit_events). */
  private async dropUnit(tx: Executor, unit: typeof units.$inferSelect, name: string) {
    await tx.delete(loans).where(eq(loans.unitId, unit.id));
    await this.dropOwned(tx, 'unit', unit.id);
    await retireCode(tx, unit.code, `deleted unit ${name}`);
    await tx.delete(units).where(eq(units.id, unit.id));
  }

  /** An empty place or build: nothing in it, nothing inside it, and no unit's home. */
  async location(ref: string, actor: Actor | null): Promise<void> {
    const who = requireScope(actor, 'write');
    await this.db.transaction(async (tx) => {
      const loc = await this.locations.resolve(ref, tx);
      if (loc.kind !== 'normal') throw invalid('places.cantDelete', { name: loc.name });
      await checkEmpty(tx, loc);
      await tx.delete(locationMoves).where(eq(locationMoves.locationId, loc.id));
      await this.dropOwned(tx, 'location', loc.id);
      // Stock that belonged back here forgets it (origin_location_id: on delete set null).
      await retireCode(tx, loc.code, `deleted place ${loc.name}`);
      await tx.update(users).set({ homeLocationId: null }).where(eq(users.homeLocationId, loc.id));
      await tx.delete(locations).where(eq(locations.id, loc.id));
      await this.locations.touch(tx, [loc.parentId]);
      await audit(tx, who, 'delete', 'location', loc.id, { code: loc.code, name: loc.name });
    });
  }

  /** Files and problem reports attached to the thing. */
  private async dropOwned(tx: Executor, owner: 'part' | 'unit' | 'location', id: string) {
    if (owner !== 'unit')
      await tx
        .delete(attachments)
        .where(and(eq(attachments.ownerType, owner), eq(attachments.ownerId, id)));
    await tx.delete(reports).where(and(eq(reports.ownerType, owner), eq(reports.ownerId, id)));
  }
}

/**
 * Nothing in the place (no stock, units or places inside, archived ones too), no unit's home
 * and not lent out, as a place must be to be deleted or archived.
 */
export async function checkEmpty(tx: Executor, loc: typeof locations.$inferSelect): Promise<void> {
  await checkNotLent(tx, loc);
  if (
    (await any(tx, locations, like(locations.path, `${loc.path}_%`))) ||
    (await any(tx, stockLots, eq(stockLots.locationId, loc.id))) ||
    (await any(tx, units, eq(units.locationId, loc.id)))
  )
    throw invalid('delete.notEmpty', { name: loc.name });
  const homes = await one(
    tx.select({ n: count() }).from(units).where(eq(units.homeLocationId, loc.id)),
  );
  if (homes?.n) throw invalid('delete.homeOf', { name: loc.name, count: homes.n });
}

async function any(
  tx: Executor,
  table: typeof units | typeof stockLots | typeof locations,
  where: SQL | undefined,
): Promise<boolean> {
  const row = await one(tx.select({ n: count() }).from(table).where(where));
  return !!row?.n;
}
