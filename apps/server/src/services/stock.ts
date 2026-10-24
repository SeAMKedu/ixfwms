import {
  estimateCount,
  findLevel,
  formatAmount,
  isCompatible,
  type StockLevelDef,
  type AddStockInput,
  type AmountInput,
  type LotView,
  type MovementReason,
  type StockAmount,
  type StockLevel,
  type StockMode,
} from '@ixfwms/domain';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db, Executor } from '../db/client.js';
import { parts, stockLots, stockMovements } from '../db/schema.js';
import { invalid, notFound } from '../lib/errors.js';
import { newId, nowIso } from '../lib/ids.js';
import { requireScope, type Actor } from './context.js';
import type { LocationRow, LocationService } from './locations.js';
import type { PartResolver } from './parts.js';
import type { SettingsService } from './settings.js';

export type LotRow = typeof stockLots.$inferSelect;

function amountOf(
  lot: Pick<LotRow, 'mode' | 'quantity' | 'unit' | 'level' | 'tareG'>,
): StockAmount {
  return {
    mode: lot.mode,
    quantity: lot.quantity,
    unit: lot.unit,
    level: lot.level,
    tareG: lot.tareG,
  };
}

function toAmount(input: AmountInput): StockAmount {
  return {
    mode: input.mode,
    quantity: input.mode === 'level' ? null : (input.quantity ?? null),
    unit: input.mode === 'measure' ? (input.unit ?? null) : null,
    level: input.mode === 'level' ? (input.level ?? null) : null,
    tareG: input.tareG ?? null,
  };
}

/** Pieces are counted in whole numbers; weights and lengths may have decimals. */
function checkWhole(mode: StockMode, quantity: number): void {
  if (mode === 'count' && !Number.isInteger(quantity))
    throw invalid('stock.notWhole', { quantity });
}

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
    const part = await tx
      .select({ name: parts.name, tracking: parts.tracking })
      .from(parts)
      .where(eq(parts.id, partId))
      .get();
    if (part?.tracking === 'individual')
      throw invalid('stock.trackedOneByOne', { name: part.name });
    if (amount.mode === 'level' && amount.level)
      amount = { ...amount, level: await this.levelKey(amount.level) };
    if (amount.quantity != null) checkWhole(amount.mode, amount.quantity);
    const levels = await this.levels();
    const location = locationRef
      ? await this.locations.resolve(locationRef, tx)
      : await this.locations.inbox(tx);
    const existing = (
      await tx
        .select()
        .from(stockLots)
        .where(
          and(
            eq(stockLots.partId, partId),
            eq(stockLots.locationId, location.id),
            isNull(stockLots.originLocationId),
          ),
        )
        .all()
    ).find((lot) => isCompatible(lot, amount));

    let lotId: string;
    if (existing) {
      lotId = existing.id;
      await tx
        .update(stockLots)
        .set({ ...merge(amountOf(existing), amount, levels), updatedAt: nowIso() })
        .where(eq(stockLots.id, lotId));
    } else {
      lotId = newId();
      await tx.insert(stockLots).values({
        id: lotId,
        partId,
        locationId: location.id,
        mode: amount.mode,
        quantity: amount.quantity,
        unit: amount.unit,
        level: amount.level,
        tareG: amount.tareG ?? null,
        note,
        lastCheckedAt: nowIso(),
      });
    }
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
        const left = (lot.quantity ?? 0) - quantity;
        if (left < 0)
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
      const next = toAmount(amount);
      if (next.mode === 'level' && next.level) next.level = await this.levelKey(next.level);
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

  /** `who` is null for someone without an account (allowed only for some moves, see OpenActions), who may give a name. */
  async moveWithin(
    tx: Executor,
    lotId: string,
    toRef: string,
    quantity: number | null,
    who: Actor | null,
    guest: string | null = null,
  ): Promise<string> {
    const lot = await this.lot(tx, lotId);
    const dest = await this.locations.resolve(toRef, tx);
    if (dest.id === lot.locationId) return lot.id;
    const whole = quantity == null || lot.mode === 'level' || quantity >= (lot.quantity ?? 0);
    if (!whole && quantity <= 0) throw invalid('stock.givePositive');
    if (!whole) checkWhole(lot.mode, quantity);

    const moved: StockAmount = whole ? amountOf(lot) : { ...amountOf(lot), quantity };
    const origin = await this.originAfter(tx, lot, dest);
    const target = await this.matchingLot(tx, lot, dest.id, origin);

    let destLotId: string;
    if (whole && !target) {
      await tx
        .update(stockLots)
        .set({ locationId: dest.id, originLocationId: origin, updatedAt: nowIso() })
        .where(eq(stockLots.id, lot.id));
      destLotId = lot.id;
    } else {
      if (target) {
        await tx
          .update(stockLots)
          .set({ ...merge(amountOf(target), moved, await this.levels()), updatedAt: nowIso() })
          .where(eq(stockLots.id, target.id));
        destLotId = target.id;
      } else {
        destLotId = newId();
        await tx.insert(stockLots).values({
          id: destLotId,
          partId: lot.partId,
          locationId: dest.id,
          mode: lot.mode,
          quantity: moved.quantity,
          unit: lot.unit,
          level: lot.level,
          note: lot.note,
          lastCheckedAt: lot.lastCheckedAt,
          originLocationId: origin,
        });
      }
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
    });
    return destLotId;
  }

  /** The lot at `locationId` that stock like `lot`, with this origin, merges into. */
  private async matchingLot(
    tx: Executor,
    lot: LotRow,
    locationId: string,
    origin: string | null,
    partId = lot.partId,
  ): Promise<LotRow | undefined> {
    return (
      await tx
        .select()
        .from(stockLots)
        .where(
          and(
            eq(stockLots.partId, partId),
            eq(stockLots.locationId, locationId),
            origin ? eq(stockLots.originLocationId, origin) : isNull(stockLots.originLocationId),
          ),
        )
        .all()
    ).find((l) => l.id !== lot.id && isCompatible(l, lot));
  }

  /**
   * Gives every lot of one part to another (merging duplicates): where the other part already
   * has a lot like it, at the same place and from the same place, the amounts add up.
   */
  async moveLotsToPart(tx: Executor, fromPartId: string, toPartId: string): Promise<void> {
    const levels = await this.levels();
    for (const lot of await tx
      .select()
      .from(stockLots)
      .where(eq(stockLots.partId, fromPartId))
      .all()) {
      const target = await this.matchingLot(
        tx,
        lot,
        lot.locationId,
        lot.originLocationId,
        toPartId,
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
    const lots = await ex.select().from(stockLots).where(eq(stockLots.partId, partId)).all();
    return Promise.all(lots.map((l) => this.toView(ex, l)));
  }

  async lotsAt(locationId: string, ex: Executor = this.db): Promise<LotRow[]> {
    return ex.select().from(stockLots).where(eq(stockLots.locationId, locationId)).all();
  }

  async view(ex: Executor, lotId: string): Promise<LotView> {
    return this.toView(ex, await this.lot(ex, lotId));
  }

  private async toView(ex: Executor, lot: LotRow): Promise<LotView> {
    const part = await ex
      .select({ unitMassG: parts.unitMassG })
      .from(parts)
      .where(eq(parts.id, lot.partId))
      .get();
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
    const lot = await ex.select().from(stockLots).where(eq(stockLots.id, lotId)).get();
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
    },
  ): Promise<void> {
    const lot = await ex.select().from(stockLots).where(eq(stockLots.id, lotId)).get();
    await this.locations.touch(ex, [m.from, m.to, lot?.locationId]);
    await ex.insert(stockMovements).values({
      id: newId(),
      partId: m.partId ?? lot!.partId,
      lotId,
      fromLocationId: m.from ?? null,
      toLocationId: m.to ?? null,
      reason,
      delta: m.delta ?? null,
      after: lot ? { ...amountOf(lot), locationId: lot.locationId } : null,
      note: m.note ?? null,
      userId: m.who?.userId ?? null,
      reporterName: m.who ? null : (m.guest ?? null),
    });
  }
}

/** Combines two compatible amounts: quantities add up, levels keep the better one (earlier in the list). */
function merge(
  into: StockAmount,
  add: StockAmount,
  levels: StockLevelDef[],
): Pick<StockAmount, 'quantity' | 'level'> {
  if (into.mode === 'level') {
    const rank = (key: string | null) => {
      const i = levels.findIndex((l) => l.key === key);
      return i < 0 ? levels.length : i;
    };
    return { quantity: null, level: rank(add.level) < rank(into.level) ? add.level : into.level };
  }
  return { quantity: (into.quantity ?? 0) + (add.quantity ?? 0), level: null };
}
