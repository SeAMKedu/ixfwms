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
} from '@ixfwms/domain';
import { and, desc, eq, lte } from 'drizzle-orm';
import type { Db, Executor } from '../db/client.js';
import { locations, parts, stockLots, stockMovements } from '../db/schema.js';
import { invalid, notFound } from '../lib/errors.js';
import { newId, nowIso } from '../lib/ids.js';
import { requireScope, type Actor } from './context.js';
import type { LocationService } from './locations.js';
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
      throw invalid(`Unknown level "${text}". Levels: ${levels.map((l) => l.name).join(', ')}`);
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
      throw invalid(`${part.name} is tracked one by one; add units instead of an amount`);
    if (amount.mode === 'level' && amount.level)
      amount = { ...amount, level: await this.levelKey(amount.level) };
    const levels = await this.levels();
    const location = locationRef
      ? await this.locations.resolve(locationRef, tx)
      : await this.locations.inbox(tx);
    const existing = (
      await tx
        .select()
        .from(stockLots)
        .where(and(eq(stockLots.partId, partId), eq(stockLots.locationId, location.id)))
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
        if (!level) throw invalid('This stock is tracked as a level; give the new level');
        await tx
          .update(stockLots)
          .set({ level: await this.levelKey(level), updatedAt: nowIso() })
          .where(eq(stockLots.id, lot.id));
      } else {
        if (quantity == null || quantity <= 0) throw invalid('Give how much was taken');
        const left = (lot.quantity ?? 0) - quantity;
        if (left < 0)
          throw invalid(`Only ${formatAmount(amountOf(lot))} here, can't take ${quantity}`);
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

  /** `who` is null for someone without an account (allowed only for some moves, see OpenActions). */
  async moveWithin(
    tx: Executor,
    lotId: string,
    toRef: string,
    quantity: number | null,
    who: Actor | null,
    note: string | null = null,
  ): Promise<string> {
    const lot = await this.lot(tx, lotId);
    const dest = await this.locations.resolve(toRef, tx);
    if (dest.id === lot.locationId) return lot.id;
    const whole = quantity == null || lot.mode === 'level' || quantity >= (lot.quantity ?? 0);
    if (!whole && quantity <= 0) throw invalid('Give a positive quantity to move');

    const moved: StockAmount = whole ? amountOf(lot) : { ...amountOf(lot), quantity };
    const target = (
      await tx
        .select()
        .from(stockLots)
        .where(and(eq(stockLots.partId, lot.partId), eq(stockLots.locationId, dest.id)))
        .all()
    ).find((l) => isCompatible(l, lot));

    let destLotId: string;
    if (whole && !target) {
      await tx
        .update(stockLots)
        .set({ locationId: dest.id, updatedAt: nowIso() })
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
      note,
      partId: lot.partId,
    });
    return destLotId;
  }

  /**
   * Where a lot came from: the place of the last move into where it is now, looking past
   * "being carried" (scan, carry, scan) to where it was picked up. Null when nobody knows.
   */
  async originOf(ex: Executor, lot: LotRow): Promise<string | null> {
    let place = lot.locationId;
    let before: string | undefined;
    for (let hop = 0; hop < 4; hop++) {
      const conditions = [
        eq(stockMovements.partId, lot.partId),
        eq(stockMovements.toLocationId, place),
        eq(stockMovements.reason, 'move'),
      ];
      if (before) conditions.push(lte(stockMovements.at, before));
      const last = await ex
        .select()
        .from(stockMovements)
        .where(and(...conditions))
        .orderBy(desc(stockMovements.at))
        .limit(1)
        .get();
      if (!last?.fromLocationId) return null;
      const from = await ex
        .select({ kind: locations.kind })
        .from(locations)
        .where(eq(locations.id, last.fromLocationId))
        .get();
      if (!from) return null;
      if (from.kind !== 'in_transit') return last.fromLocationId;
      place = last.fromLocationId;
      before = last.at;
    }
    return null;
  }

  /** Folds other compatible lots of the same part at the same place into this one. */
  async consolidate(tx: Executor, lotId: string): Promise<void> {
    const lot = await tx.select().from(stockLots).where(eq(stockLots.id, lotId)).get();
    if (!lot) return;
    const siblings = (
      await tx
        .select()
        .from(stockLots)
        .where(and(eq(stockLots.partId, lot.partId), eq(stockLots.locationId, lot.locationId)))
        .all()
    ).filter((l) => l.id !== lot.id && isCompatible(l, lot));
    let amount = amountOf(lot);
    const levels = await this.levels();
    for (const s of siblings) {
      amount = { ...amount, ...merge(amount, amountOf(s), levels) };
      await tx.delete(stockLots).where(eq(stockLots.id, s.id));
    }
    if (siblings.length) {
      await tx
        .update(stockLots)
        .set({ quantity: amount.quantity, level: amount.level, updatedAt: nowIso() })
        .where(eq(stockLots.id, lot.id));
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
    };
  }

  private async lot(ex: Executor, lotId: string): Promise<LotRow> {
    const lot = await ex.select().from(stockLots).where(eq(stockLots.id, lotId)).get();
    if (!lot) throw notFound('Stock lot', lotId);
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
