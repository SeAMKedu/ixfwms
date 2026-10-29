import {
  formatAmount,
  type CarriedItem,
  type CarrySummary,
  type CarryState,
  type MoveAmount,
} from '@ixfwms/domain';
import { asc, eq } from 'drizzle-orm';
import { many, type Db } from '../db/client.js';
import { locations, parts, stockLots, units, users } from '../db/schema.js';
import { invalid } from '../lib/errors.js';
import { personName, requireScope, type Actor } from './context.js';
import type { LocationService } from './locations.js';
import type { StockService } from './stock.js';
import type { UnitService } from './units.js';

/**
 * "Scan, carry, scan": picked-up things sit in the person's own "Carried by <name>" place,
 * so they never vanish from the inventory while being moved, and a dead phone loses nothing.
 */
export class CarryService {
  constructor(
    private readonly db: Db,
    private readonly locations: LocationService,
    private readonly stock: StockService,
    private readonly units: UnitService,
  ) {}

  async state(actor: Actor | null): Promise<CarryState> {
    const who = requireScope(actor, 'inventory');
    const carry = await this.locations.inTransitFor(who);
    const lots = await many(
      this.db
        .select({ lot: stockLots, code: parts.code, name: parts.name })
        .from(stockLots)
        .innerJoin(parts, eq(parts.id, stockLots.partId))
        .where(eq(stockLots.locationId, carry.id))
        .orderBy(asc(stockLots.updatedAt)),
    );
    const boxes = await many(
      this.db
        .select()
        .from(locations)
        .where(eq(locations.parentId, carry.id))
        .orderBy(asc(locations.updatedAt)),
    );
    const unitRows = await many(
      this.db
        .select()
        .from(units)
        .where(eq(units.locationId, carry.id))
        .orderBy(asc(units.updatedAt)),
    );
    const unitBriefs = await this.units.briefs(unitRows);
    const items: CarriedItem[] = [
      ...unitBriefs.map((u, i) => ({
        kind: 'unit' as const,
        id: u.id,
        code: u.code,
        name: u.name,
        since: unitRows[i]!.updatedAt,
      })),
      ...boxes.map((b) => ({
        kind: 'location' as const,
        id: b.id,
        code: b.code,
        name: b.name,
        since: b.updatedAt,
      })),
      ...lots.map((l) => ({
        kind: 'lot' as const,
        id: l.lot.id,
        part: { code: l.code, name: l.name },
        display: formatAmount(l.lot),
        since: l.lot.updatedAt,
      })),
    ];
    const since = items.map((i) => i.since).sort()[0] ?? null;
    return { location: await this.locations.summarize(this.db, carry), items, since };
  }

  /** Everyone's non-empty carry lists, oldest first: things that may have been forgotten "in transit". */
  async everyone(): Promise<CarrySummary[]> {
    const carries = await many(
      this.db
        .select({ loc: locations, user: users.name })
        .from(locations)
        .innerJoin(users, eq(users.id, locations.ownerUserId))
        .where(eq(locations.kind, 'in_transit')),
    );
    const out: CarrySummary[] = [];
    for (const { loc, user } of carries) {
      const lots = await many(
        this.db
          .select({ at: stockLots.updatedAt })
          .from(stockLots)
          .where(eq(stockLots.locationId, loc.id)),
      );
      const boxes = await many(
        this.db
          .select({ at: locations.updatedAt })
          .from(locations)
          .where(eq(locations.parentId, loc.id)),
      );
      const carried = await many(
        this.db.select({ at: units.updatedAt }).from(units).where(eq(units.locationId, loc.id)),
      );
      const times = [...lots, ...boxes, ...carried].map((r) => r.at).sort();
      if (times.length === 0) continue;
      out.push({
        user: personName(user),
        location: await this.locations.summarize(this.db, loc),
        count: times.length,
        since: times[0]!,
      });
    }
    return out.sort((a, b) => a.since.localeCompare(b.since));
  }

  /** Picks up a whole place (with its contents), some of a stock lot, or a unit. */
  async pick(
    input: {
      location?: string | null;
      lotId?: string | null;
      unit?: string | null;
      quantity?: number | null;
      pieces?: number | null;
      cut?: MoveAmount['cut'];
    },
    actor: Actor | null,
  ): Promise<CarryState> {
    const who = requireScope(actor, 'inventory');
    if ([input.location, input.lotId, input.unit].filter((x) => x != null).length !== 1)
      throw invalid('carry.pickWhat');
    await this.db.transaction(async (tx) => {
      const carry = await this.locations.inTransitFor(who, tx);
      if (input.unit)
        await this.units.moveWithin(tx, await this.units.resolve(input.unit, tx), carry.id, who);
      else if (input.location)
        await this.locations.moveWithin(
          tx,
          await this.locations.resolve(input.location, tx),
          carry.id,
          who,
        );
      else await this.stock.pieces.move(tx, input.lotId!, carry.id, input, who);
    });
    return this.state(who);
  }

  /** Puts down everything carried (or only `items`, by id) at the destination. */
  async drop(
    to: string,
    items: string[] | null,
    actor: Actor | null,
  ): Promise<{ moved: number; state: CarryState }> {
    const who = requireScope(actor, 'inventory');
    const current = await this.state(who);
    const chosen = current.items.filter((i) => !items || items.includes(i.id));
    if (chosen.length === 0) throw invalid('carry.nothing');
    await this.db.transaction(async (tx) => {
      const dest = await this.locations.resolve(to, tx);
      if (dest.kind === 'in_transit') throw invalid('carry.realPlace');
      for (const item of chosen) {
        if (item.kind === 'unit') {
          await this.units.checkDestination(dest, tx);
          await this.units.moveWithin(tx, await this.units.resolve(item.id, tx), dest.id, who);
        } else if (item.kind === 'location')
          await this.locations.moveWithin(
            tx,
            await this.locations.resolve(item.id, tx),
            dest.id,
            who,
          );
        else await this.stock.moveWithin(tx, item.id, dest.id, null, who);
      }
    });
    return { moved: chosen.length, state: await this.state(who) };
  }
}
