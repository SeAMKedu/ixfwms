import {
  estimateCount,
  findLevel,
  formatAmount,
  isCompatible,
  isUnknown,
  type StockLevelDef,
  type AddStockInput,
  type AmountInput,
  type LotView,
  type MovementReason,
  type StockAmount,
  type StockLevel,
} from '@ixfwms/domain';
import { and, eq, isNull } from 'drizzle-orm';
import { many, one, type Db, type Executor } from '../db/client.js';
import { brokenRule } from '../db/dialect.js';
import { parts, stockLots, stockMovements } from '../db/schema.js';
import { invalid, notFound } from '../lib/errors.js';
import { newId, nowIso } from '../lib/ids.js';
import { amountOf, checkWhole, merge, toAmount } from './amounts.js';
import { requireScope, type Actor } from './context.js';
import type { LocationRow, LocationService } from './locations.js';
import type { PartResolver } from './parts.js';
import type { SettingsService } from './settings.js';

export type LotRow = typeof stockLots.$inferSelect;

/** What decides which lot stock goes into: one lot per part, place, kind of amount and origin. */
type LotKey = Pick<LotRow, 'partId' | 'mode' | 'unit'>;

export class StockService {
  constructor(
    private readonly db: Db,
    private readonly locations: LocationService,
    private readonly parts: PartResolver,
    private readonly settings: SettingsService,
  ) {}

  /** The lab's stock levels, best first. */
  async levels(): Promise<StockLevelDef[]> {
    return (await this.settings.get()).stockLevels;
  }

  /** The key of a level given by key or name; an error lists the lab's levels otherwise. */
  async levelKey(text: string): Promise<string> {
    const levels = await this.levels();
    const level = findLevel(text, levels);
    if (!level)
      throw invalid('stock.unknownLevel', {
        level: text,
        levels: levels.map((l) => l.name).join(', '),
      });
    return level.key;
  }

  async add(input: AddStockInput, actor: Actor | null): Promise<LotView> {
    const who = requireScope(actor, 'inventory');
    return this.db.transaction(async (tx) => {
      const part = await this.parts.resolve(input.part, tx);
      const lotId = await this.addWithin(
        tx,
        part.id,
        input.location ?? null,
        toAmount(input.amount),
        who,
        input.note ?? null,
      );
      return this.view(tx, lotId);
    });
  }

  /** Adds stock inside an existing transaction; merges into a compatible lot at the same place. */
  async addWithin(
    tx: Executor,
    partId: string,
    locationRef: string | null,
    amount: StockAmount,
    who: Actor,
    note: string | null,
    reason: MovementReason = 'add',
  ): Promise<string> {
    const part = await one(
      tx
        .select({ name: parts.name, tracking: parts.tracking })
        .from(parts)
        .where(eq(parts.id, partId)),
    );
    if (part?.tracking === 'individual')
      throw invalid('stock.trackedOneByOne', { name: part.name });
    if (amount.mode === 'level' && amount.level)
      amount = { ...amount, level: await this.levelKey(amount.level) };
    checkWhole(amount.mode, amount.quantity);
    const location = locationRef
      ? await this.locations.resolve(locationRef, tx)
      : await this.locations.inbox(tx);
    const lotId = await this.put(tx, { partId, ...amount }, location.id, null, amount, {
      note,
      // Stock nobody has counted hasn't been checked either.
      lastCheckedAt: isUnknown(amount) ? null : nowIso(),
      tareG: amount.tareG ?? null,
    });
    await this.record(tx, lotId, reason, { to: location.id, delta: amount.quantity, note, who });
    return lotId;
  }

  /** Takes some out of a lot ("took 2"). For level-tracked lots, sets the new level instead. */
  async take(
    lotId: string,
    quantity: number | null,
    level: StockLevel | null,
    actor: Actor | null,
  ): Promise<LotView> {
    const who = requireScope(actor, 'inventory');
    return this.db.transaction(async (tx) => {
      const lot = await this.lot(tx, lotId);
      if (lot.mode === 'level') {
        if (!level) throw invalid('stock.giveLevel');
        await tx
          .update(stockLots)
          .set({ level: await this.levelKey(level), updatedAt: nowIso() })
          .where(eq(stockLots.id, lot.id));
      } else {
        if (quantity == null || quantity <= 0) throw invalid('stock.giveTaken');
        checkWhole(lot.mode, quantity);
        // Taking from stock nobody has counted leaves it uncounted.
        const left = lot.quantity == null ? null : lot.quantity - quantity;
        if (left != null && left < 0)
          throw invalid('stock.notEnough', { amount: formatAmount(amountOf(lot)), quantity });
        await tx
          .update(stockLots)
          .set({ quantity: left, updatedAt: nowIso() })
          .where(eq(stockLots.id, lot.id));
      }
      await this.record(tx, lot.id, 'take', {
        from: lot.locationId,
        delta: quantity == null ? null : -quantity,
        who,
      });
      return this.view(tx, lot.id);
    });
  }

  /** Sets the counted/measured amount after checking it (stocktake). */
  async stocktake(lotId: string, amount: AmountInput, actor: Actor | null): Promise<LotView> {
    const who = requireScope(actor, 'inventory');
    return this.db.transaction(async (tx) => {
      const lot = await this.lot(tx, lotId);
      if (amount.uncounted) throw invalid('stock.countIt');
      const next = toAmount(amount);
      if (next.mode === 'level' && next.level) next.level = await this.levelKey(next.level);
      checkWhole(next.mode, next.quantity);
      await tx
        .update(stockLots)
        .set({
          ...next,
          tareG: next.tareG ?? lot.tareG,
          lastCheckedAt: nowIso(),
          updatedAt: nowIso(),
        })
        .where(eq(stockLots.id, lot.id));
      const delta =
        next.quantity != null && lot.quantity != null && next.mode === lot.mode
          ? next.quantity - lot.quantity
          : null;
      await this.record(tx, lot.id, 'stocktake', { from: lot.locationId, delta, who });
      return this.view(tx, lot.id);
    });
  }

  /** Moves a whole lot, or `quantity` of it, to another location. Returns the lot at the destination. */
  async move(
    lotId: string,
    toRef: string,
    quantity: number | null,
    actor: Actor | null,
  ): Promise<LotView> {
    const who = requireScope(actor, 'inventory');
    return this.db.transaction(async (tx) => {
      const destId = await this.moveWithin(tx, lotId, toRef, quantity, who);
      return this.view(tx, destId);
    });
  }

  /**
   * Where stock belongs after moving to `dest`. Back at its origin it's home again; at a
   * workstation, a temporary place or being carried it is visiting, and remembers where it
   * came from; anywhere else is its new home.
   */
  private async originAfter(tx: Executor, lot: LotRow, dest: LocationRow): Promise<string | null> {
    if (dest.id === lot.originLocationId) return null;
    const summary = await this.locations.summarize(tx, dest);
    const visiting =
      summary.kind === 'in_transit' || summary.workstation || summary.stayDays !== null;
    return visiting ? (lot.originLocationId ?? lot.locationId) : null;
  }

  /**
   * `who` is null for someone without an account (allowed only for some moves, see
   * OpenActions), who may give a name. `origin` overrides where the stock belongs afterwards
   * (undo puts back the one it had); by default the move decides (originAfter).
   */
  async moveWithin(
    tx: Executor,
    lotId: string,
    toRef: string,
    quantity: number | null,
    who: Actor | null,
    guest: string | null = null,
    origin?: string | null,
  ): Promise<string> {
    const lot = await this.lot(tx, lotId);
    const dest = await this.locations.resolve(toRef, tx);
    if (dest.id === lot.locationId) return lot.id;
    if (quantity != null && lot.mode !== 'level' && lot.quantity == null)
      throw invalid('stock.uncountedPart');
    const whole = quantity == null || lot.mode === 'level' || quantity >= (lot.quantity ?? 0);
    if (!whole && quantity <= 0) throw invalid('stock.givePositive');
    if (!whole) checkWhole(lot.mode, quantity);

    const moved: StockAmount = whole ? amountOf(lot) : { ...amountOf(lot), quantity };
    const belongs = origin !== undefined ? origin : await this.originAfter(tx, lot, dest);

    let destLotId: string;
    if (whole && !(await this.matchingLot(tx, lot, dest.id, belongs, lot.id))) {
      // The lot itself moves, keeping its id (and its history).
      destLotId = await this.orMerge(
        tx,
        (sp) =>
          sp
            .update(stockLots)
            .set({ locationId: dest.id, originLocationId: belongs, updatedAt: nowIso() })
            .where(eq(stockLots.id, lot.id))
            .then(() => lot.id),
        () => this.mergeInto(tx, lot, dest.id, belongs, moved, lot.id),
      );
      if (destLotId !== lot.id) await tx.delete(stockLots).where(eq(stockLots.id, lot.id));
    } else {
      destLotId = await this.put(tx, lot, dest.id, belongs, moved, {
        note: lot.note,
        lastCheckedAt: lot.lastCheckedAt,
        tareG: null,
      });
      if (whole) await tx.delete(stockLots).where(eq(stockLots.id, lot.id));
      else
        await tx
          .update(stockLots)
          .set({ quantity: (lot.quantity ?? 0) - quantity, updatedAt: nowIso() })
          .where(eq(stockLots.id, lot.id));
    }
    await this.record(tx, destLotId, 'move', {
      from: lot.locationId,
      to: dest.id,
      delta: moved.quantity,
      who,
      guest,
      partId: lot.partId,
      originBefore: lot.originLocationId,
    });
    return destLotId;
  }

  /** The lot at `locationId` that stock like `like`, with this origin, merges into. */
  private async matchingLot(
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
  private async mergeInto(
    tx: Executor,
    like: LotKey,
    locationId: string,
    origin: string | null,
    amount: StockAmount,
    exceptId: string | null = null,
  ): Promise<string | null> {
    const target = await this.matchingLot(tx, like, locationId, origin, exceptId);
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
  private async put(
    tx: Executor,
    like: LotKey,
    locationId: string,
    origin: string | null,
    amount: StockAmount,
    fresh: Pick<LotRow, 'note' | 'lastCheckedAt' | 'tareG'>,
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
  private async orMerge(
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
   * Gives every lot of one part to another (merging duplicates): where the other part already
   * has a lot like it, at the same place and from the same place, the amounts add up.
   */
  async moveLotsToPart(tx: Executor, fromPartId: string, toPartId: string): Promise<void> {
    const levels = await this.levels();
    for (const lot of await many(
      tx.select().from(stockLots).where(eq(stockLots.partId, fromPartId)),
    )) {
      const target = await this.matchingLot(
        tx,
        { ...lot, partId: toPartId },
        lot.locationId,
        lot.originLocationId,
      );
      if (!target) {
        await tx.update(stockLots).set({ partId: toPartId }).where(eq(stockLots.id, lot.id));
        continue;
      }
      await tx
        .update(stockLots)
        .set({ ...merge(amountOf(target), amountOf(lot), levels), updatedAt: nowIso() })
        .where(eq(stockLots.id, target.id));
      await tx.delete(stockLots).where(eq(stockLots.id, lot.id));
    }
  }

  async lotsOfPart(partId: string, ex: Executor = this.db): Promise<LotView[]> {
    const lots = await many(ex.select().from(stockLots).where(eq(stockLots.partId, partId)));
    return Promise.all(lots.map((l) => this.toView(ex, l)));
  }

  async lotsAt(locationId: string, ex: Executor = this.db): Promise<LotRow[]> {
    return many(ex.select().from(stockLots).where(eq(stockLots.locationId, locationId)));
  }

  async view(ex: Executor, lotId: string): Promise<LotView> {
    return this.toView(ex, await this.lot(ex, lotId));
  }

  private async toView(ex: Executor, lot: LotRow): Promise<LotView> {
    const part = await one(
      ex.select({ unitMassG: parts.unitMassG }).from(parts).where(eq(parts.id, lot.partId)),
    );
    const location = await this.locations.resolve(lot.locationId, ex);
    const path = await this.locations.pathOf(location, ex);
    const amount = amountOf(lot);
    const origin = lot.originLocationId
      ? await this.locations.resolve(lot.originLocationId, ex)
      : null;
    return {
      id: lot.id,
      partId: lot.partId,
      amount,
      display: formatAmount(amount),
      estimatedCount: estimateCount(amount, part?.unitMassG),
      note: lot.note,
      lastCheckedAt: lot.lastCheckedAt,
      location: path[path.length - 1]!,
      path,
      origin: origin && { code: origin.code, name: origin.name },
    };
  }

  private async lot(ex: Executor, lotId: string): Promise<LotRow> {
    const lot = await one(ex.select().from(stockLots).where(eq(stockLots.id, lotId)));
    if (!lot) throw notFound('stockLot', lotId);
    return lot;
  }

  private async record(
    ex: Executor,
    lotId: string,
    reason: MovementReason,
    m: {
      from?: string;
      to?: string;
      delta?: number | null;
      note?: string | null;
      who: Actor | null;
      guest?: string | null;
      partId?: string;
      /** Moves: where the stock belonged before, which undo puts back. */
      originBefore?: string | null;
    },
  ): Promise<void> {
    const lot = await one(ex.select().from(stockLots).where(eq(stockLots.id, lotId)));
    await this.locations.touch(ex, [m.from, m.to, lot?.locationId]);
    await ex.insert(stockMovements).values({
      id: newId(),
      partId: m.partId ?? lot!.partId,
      lotId,
      fromLocationId: m.from ?? null,
      toLocationId: m.to ?? null,
      reason,
      delta: m.delta ?? null,
      after: lot
        ? {
            ...amountOf(lot),
            locationId: lot.locationId,
            ...(m.originBefore !== undefined && { originBefore: m.originBefore }),
          }
        : null,
      note: m.note ?? null,
      userId: m.who?.userId ?? null,
      reporterName: m.who ? null : (m.guest ?? null),
    });
  }
}
