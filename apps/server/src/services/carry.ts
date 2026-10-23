import { formatAmount, type CarriedItem, type CarrySummary, type CarryState } from '@ixfwms/domain';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { locations, parts, stockLots, users } from '../db/schema.js';
import { invalid } from '../lib/errors.js';
import { requireScope, type Actor } from './context.js';
import type { LocationService } from './locations.js';
import type { StockService } from './stock.js';

/**
 * "Scan, carry, scan": picked-up things sit in the person's own "Carried by <name>" place,
 * so they never vanish from the inventory while being moved, and a dead phone loses nothing.
 */
export class CarryService {
  constructor(
    private readonly db: Db,
    private readonly locations: LocationService,
    private readonly stock: StockService,
  ) {}

  async state(actor: Actor | null): Promise<CarryState> {
    const who = requireScope(actor, 'inventory');
    const carry = await this.locations.inTransitFor(who);
    const lots = await this.db
      .select({ lot: stockLots, code: parts.code, name: parts.name })
      .from(stockLots)
      .innerJoin(parts, eq(parts.id, stockLots.partId))
      .where(eq(stockLots.locationId, carry.id))
      .orderBy(asc(stockLots.updatedAt))
      .all();
    const boxes = await this.db
      .select()
      .from(locations)
      .where(eq(locations.parentId, carry.id))
      .orderBy(asc(locations.updatedAt))
      .all();
    const items: CarriedItem[] = [
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
    const carries = await this.db
      .select({ loc: locations, user: users.name })
      .from(locations)
      .innerJoin(users, eq(users.id, locations.ownerUserId))
      .where(eq(locations.kind, 'in_transit'))
      .all();
    const out: CarrySummary[] = [];
    for (const { loc, user } of carries) {
      const lots = await this.db
        .select({ at: stockLots.updatedAt })
        .from(stockLots)
        .where(eq(stockLots.locationId, loc.id))
        .all();
      const boxes = await this.db
        .select({ at: locations.updatedAt })
        .from(locations)
        .where(eq(locations.parentId, loc.id))
        .all();
      const times = [...lots, ...boxes].map((r) => r.at).sort();
      if (times.length === 0) continue;
      out.push({
        user,
        location: await this.locations.summarize(this.db, loc),
        count: times.length,
        since: times[0]!,
      });
    }
    return out.sort((a, b) => a.since.localeCompare(b.since));
  }

  /** Picks up a whole place (with its contents) or some of a stock lot. */
  async pick(
    input: { location?: string | null; lotId?: string | null; quantity?: number | null },
    actor: Actor | null,
  ): Promise<CarryState> {
    const who = requireScope(actor, 'inventory');
    if ((input.location == null) === (input.lotId == null))
      throw invalid('Pick either a place or a stock lot');
    await this.db.transaction(async (tx) => {
      const carry = await this.locations.inTransitFor(who, tx);
      if (input.location)
        await this.locations.moveWithin(
          tx,
          await this.locations.resolve(input.location, tx),
          carry.id,
          who,
        );
      else await this.stock.moveWithin(tx, input.lotId!, carry.id, input.quantity ?? null, who);
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
    if (chosen.length === 0) throw invalid('Nothing to put down');
    await this.db.transaction(async (tx) => {
      const dest = await this.locations.resolve(to, tx);
      if (dest.kind === 'in_transit') throw invalid('Pick a real place to put things down');
      for (const item of chosen) {
        if (item.kind === 'location')
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
