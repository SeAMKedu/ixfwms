import { isCompatible, isUnknown, type StockAmount, type StockLevelDef } from '@ixfwms/domain';
import { and, eq, isNull } from 'drizzle-orm';
import { many, type Executor } from '../db/client.js';
import { brokenRule } from '../db/dialect.js';
import { stockLots } from '../db/schema.js';
import { newId, nowIso } from '../lib/ids.js';
import { amountOf, merge } from './amounts.js';

type LotRow = typeof stockLots.$inferSelect;

/** What decides which lot stock goes into: one lot per part, place, kind of amount and origin. */
export type LotKey = Pick<LotRow, 'partId' | 'mode' | 'unit'>;

/** Finds the lot stock goes into at a place, merges into it, or makes a new one. */
export class LotStore {
  constructor(private readonly levels: () => Promise<StockLevelDef[]>) {}

  /** The lot at `locationId` that stock like `like`, with this origin, merges into. */
  async matching(
    tx: Executor,
    like: LotKey,
    locationId: string,
    origin: string | null,
    exceptId: string | null = null,
  ): Promise<LotRow | undefined> {
    return (
      await many(
        tx
          .select()
          .from(stockLots)
          .where(
            and(
              eq(stockLots.partId, like.partId),
              eq(stockLots.locationId, locationId),
              origin ? eq(stockLots.originLocationId, origin) : isNull(stockLots.originLocationId),
            ),
          ),
      )
    ).find((l) => l.id !== exceptId && isCompatible(l, like));
  }

  /** Adds `amount` to the lot like `like` at the place, if there is one; returns its id. */
  async mergeInto(
    tx: Executor,
    like: LotKey,
    locationId: string,
    origin: string | null,
    amount: StockAmount,
    exceptId: string | null = null,
  ): Promise<string | null> {
    const target = await this.matching(tx, like, locationId, origin, exceptId);
    if (!target) return null;
    const merged = merge(amountOf(target), amount, await this.levels());
    // Uncounted stock joined it: the last count no longer says how much is there.
    const unchecked = isUnknown({ mode: target.mode, ...merged }) && { lastCheckedAt: null };
    await tx
      .update(stockLots)
      .set({ ...merged, ...unchecked, updatedAt: nowIso() })
      .where(eq(stockLots.id, target.id));
    return target.id;
  }

  /** Puts `amount` at the place: into the lot like it there, or a new lot. Returns the lot's id. */
  async put(
    tx: Executor,
    like: LotKey,
    locationId: string,
    origin: string | null,
    amount: StockAmount,
    fresh: Pick<LotRow, 'note' | 'lastCheckedAt'>,
  ): Promise<string> {
    const merged = await this.mergeInto(tx, like, locationId, origin, amount);
    if (merged) return merged;
    const id = newId();
    return this.orMerge(
      tx,
      (sp) =>
        sp
          .insert(stockLots)
          .values({
            id,
            partId: like.partId,
            locationId,
            originLocationId: origin,
            mode: amount.mode,
            quantity: amount.quantity,
            unit: amount.unit,
            level: amount.level,
            pieces: amount.mode === 'cut' ? (amount.pieces ?? []) : null,
            ...fresh,
          })
          .then(() => id),
      () => this.mergeInto(tx, like, locationId, origin, amount),
    );
  }

  /**
   * Runs a write that makes a lot somewhere. Two requests adding or moving the same stock at
   * once can both find no lot there; the second one's write then breaks the one-lot index
   * (stock_lots_one_per_place) and merges into the lot the first one made instead. The write
   * runs in a savepoint, so the failed statement leaves the transaction usable.
   */
  async orMerge(
    tx: Executor,
    write: (sp: Executor) => Promise<string>,
    instead: () => Promise<string | null>,
  ): Promise<string> {
    try {
      return await tx.transaction(write);
    } catch (err) {
      if (brokenRule(err) !== 'unique') throw err;
      const merged = await instead();
      if (!merged) throw err;
      return merged;
    }
  }

  /**
   * The lot at the place that counted pieces of this part disappear into when there is no
   * counted one: an amount that doesn't count pieces (a level, stock nobody counted, a weight,
   * length or volume), from the same origin.
   */
  async sink(
    tx: Executor,
    partId: string,
    locationId: string,
    origin: string | null,
  ): Promise<LotRow | undefined> {
    const here = await many(
      tx
        .select()
        .from(stockLots)
        .where(
          and(
            eq(stockLots.partId, partId),
            eq(stockLots.locationId, locationId),
            origin ? eq(stockLots.originLocationId, origin) : isNull(stockLots.originLocationId),
          ),
        ),
    );
    if (here.some((l) => l.mode === 'count')) return undefined;
    return here.find((l) => l.mode === 'level' || l.mode === 'measure');
  }
}
