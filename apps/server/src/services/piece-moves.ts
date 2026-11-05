import {
  bestLeftover,
  sizeInUnit,
  fitIn,
  formatAmount,
  formatPiece,
  leftovers,
  pickPiece,
  piecesIn,
  type MoveAmount,
  type Piece,
} from '@ixfwms/domain';
import { eq } from 'drizzle-orm';
import { one, type Executor } from '../db/client.js';
import { parts, stockLots } from '../db/schema.js';
import { invalid } from '../lib/errors.js';
import { nowIso } from '../lib/ids.js';
import { absorb, amountOf, countAmount, cutAmount, piecesToUnit } from './amounts.js';
import type { Actor } from '../lib/context.js';
import { checkNotLent } from '../modules/loans/rules.js';
import type { LocationRow, LocationService } from './locations.js';
import type { LotRow, StockService } from './stock.js';

type Cut = NonNullable<MoveAmount['cut']>;

/**
 * Moves that aren't "this much of the lot": a count of pieces, and a cut off a bar or sheet.
 *
 * A known count can come out of an amount that doesn't count pieces (a level, stock nobody
 * counted, a length): the pieces arrive counted, and that amount stays as unknown as it was.
 * Counted pieces going back to it disappear into it again (`absorb`). A cut takes a piece of
 * the given size off the smallest piece it fits in; what's left stays as pieces of its own.
 */
export class PieceMoves {
  constructor(
    private readonly stock: StockService,
    private readonly locations: LocationService,
  ) {}

  /** A cut, a count of pieces, or an amount in the lot's own unit (all of it without one). */
  async move(
    tx: Executor,
    lotId: string,
    toRef: string,
    amount: MoveAmount,
    who: Actor | null,
    guest: string | null = null,
  ): Promise<string> {
    const from = (await this.stock.lot(tx, lotId)).locationId;
    await checkNotLent(tx, await this.locations.resolve(from, tx));
    if (amount.cut) return this.cut(tx, lotId, toRef, amount.cut, who, guest);
    if (amount.pieces != null) return this.count(tx, lotId, toRef, amount.pieces, who, guest);
    return this.stock.moveWithin(tx, lotId, toRef, amount.quantity ?? null, who, guest);
  }

  /** `n` pieces: counted, weighed by piece mass, a cut lot's smallest, or out of an unknown amount. */
  private async count(
    tx: Executor,
    lotId: string,
    toRef: string,
    n: number,
    who: Actor | null,
    guest: string | null,
  ): Promise<string> {
    const lot = await this.stock.lot(tx, lotId);
    const part = await this.part(tx, lot.partId);
    const amount = amountOf(lot);
    const have = piecesIn(amount, part.unitMassG, await this.stock.levels());
    if (have === 0) throw invalid('stock.noneLeft');
    if (have != null && n > have)
      throw invalid('stock.notEnough', { amount: formatAmount(amount), quantity: n });
    if (lot.mode === 'count' && lot.quantity != null)
      return this.stock.moveWithin(tx, lot.id, toRef, n, who, guest);
    if (lot.mode === 'cut') {
      const pieces = [...(lot.pieces ?? [])].sort((a, b) => size(a) - size(b));
      return this.split(tx, lot, toRef, pieces.slice(n), pieces.slice(0, n), who, guest, {});
    }
    const inUnit = piecesToUnit(amount, n, part.unitMassG);
    if (inUnit != null)
      return this.stock.moveWithin(tx, lot.id, toRef, n === have ? null : inUnit, who, guest);
    // A known count out of an amount that doesn't say how many: it stays as it is.
    const dest = await this.dest(tx, toRef);
    if (dest.id === lot.locationId) return lot.id;
    const belongs = await this.stock.originAfter(tx, lot, dest);
    const destId = await this.arrive(tx, lot.partId, dest.id, belongs, n, part.unitMassG);
    await this.stock.record(tx, destId, 'move', {
      from: lot.locationId,
      to: dest.id,
      delta: n,
      who,
      guest,
      partId: lot.partId,
      originBefore: lot.originLocationId,
      extra: { fromUnknown: lot.id },
    });
    return destId;
  }

  /** Counted pieces arriving: into an amount that doesn't count them if that's there, else counted. */
  private async arrive(
    tx: Executor,
    partId: string,
    placeId: string,
    belongs: string | null,
    n: number,
    unitMassG: number | null,
  ): Promise<string> {
    const sink = await this.stock.lots.sink(tx, partId, placeId, belongs);
    if (sink) {
      await this.soak(tx, sink, n, unitMassG);
      return sink.id;
    }
    return this.stock.lots.put(
      tx,
      { partId, mode: 'count', unit: null },
      placeId,
      belongs,
      countAmount(n),
      { note: null, lastCheckedAt: nowIso() },
    );
  }

  /**
   * A counted lot (or `quantity` of it) moving where there is no counted lot, but an amount that
   * doesn't count pieces: the pieces disappear into it. Null when that isn't the case.
   */
  async absorb(
    tx: Executor,
    lot: LotRow,
    placeId: string,
    belongs: string | null,
    quantity: number | null,
    who: Actor | null,
    guest: string | null,
  ): Promise<string | null> {
    if (lot.mode !== 'count' || lot.quantity == null) return null;
    const sink = await this.stock.lots.sink(tx, lot.partId, placeId, belongs);
    if (!sink) return null;
    const n = Math.min(quantity ?? lot.quantity, lot.quantity);
    await this.soak(tx, sink, n, (await this.part(tx, lot.partId)).unitMassG);
    if (n >= lot.quantity) await tx.delete(stockLots).where(eq(stockLots.id, lot.id));
    else
      await tx
        .update(stockLots)
        .set({ quantity: lot.quantity - n, updatedAt: nowIso() })
        .where(eq(stockLots.id, lot.id));
    await this.stock.record(tx, sink.id, 'move', {
      from: lot.locationId,
      to: placeId,
      delta: n,
      who,
      guest,
      partId: lot.partId,
      originBefore: lot.originLocationId,
      extra: { absorbed: true },
    });
    return sink.id;
  }

  private async soak(tx: Executor, sink: LotRow, n: number, unitMassG: number | null) {
    const next = absorb(amountOf(sink), n, unitMassG, await this.stock.levels());
    await tx
      .update(stockLots)
      .set({ ...next, updatedAt: nowIso() })
      .where(eq(stockLots.id, sink.id));
  }

  /**
   * A piece of `cut.size` off a bar or sheet. From a cut lot: off the chosen piece, or the
   * smallest it fits in, the rest kept as pieces (a sheet's two strips, `cut.leftover`). From a
   * total length or area: that much less. From bars or sheets nobody measured (a count, a
   * level): they stay as they are. The piece arrives as cut stock.
   */
  private async cut(
    tx: Executor,
    lotId: string,
    toRef: string,
    cut: Cut,
    who: Actor | null,
    guest: string | null,
  ): Promise<string> {
    const lot = await this.stock.lot(tx, lotId);
    const part = await this.part(tx, lot.partId);
    if (!part.cut) throw invalid('stock.notCutStock', { name: part.name });
    if (cut.size.length !== (part.cut === 'sheet' ? 2 : 1)) throw invalid('stock.wrongShape');
    if (lot.mode === 'cut') {
      const pieces = lot.pieces ?? [];
      const i = cut.piece ?? pickPiece(pieces, cut.size);
      const from = pieces[i];
      const fit = from && fitIn(from, cut.size);
      if (!from || !fit) throw invalid('stock.noPieceFits', { size: formatPiece(cut.size) });
      const how = cut.leftover ?? bestLeftover(from, cut.size);
      const rest = [...pieces.filter((_, j) => j !== i), ...leftovers(from, cut.size, how)];
      return this.split(tx, lot, toRef, rest, [fit], who, guest, { cut: true });
    }
    const amount = amountOf(lot);
    const less = sizeInUnit(amount, cut.size);
    if (less != null && less > amount.quantity!)
      throw invalid('stock.noPieceFits', { size: formatPiece(cut.size) });
    if (piecesIn(amount, null, await this.stock.levels()) === 0) throw invalid('stock.noneLeft');
    const dest = await this.dest(tx, toRef);
    if (less != null)
      await tx
        .update(stockLots)
        .set({ quantity: amount.quantity! - less, updatedAt: nowIso() })
        .where(eq(stockLots.id, lot.id));
    return this.land(tx, lot, dest, [cut.size], who, guest, { cut: true });
  }

  /** A cut lot split in two: `rest` stays, `moving` goes to `toRef` as a cut lot. */
  private async split(
    tx: Executor,
    lot: LotRow,
    toRef: string,
    rest: Piece[],
    moving: Piece[],
    who: Actor | null,
    guest: string | null,
    extra: Record<string, unknown>,
  ): Promise<string> {
    const dest = await this.dest(tx, toRef);
    // Cut where it lies: the piece and what's left stay in the lot.
    const here = dest.id === lot.locationId;
    const keep = here ? [...rest, ...moving] : rest;
    if (keep.length || here)
      await tx
        .update(stockLots)
        .set({ pieces: keep, quantity: keep.length, updatedAt: nowIso() })
        .where(eq(stockLots.id, lot.id));
    else await tx.delete(stockLots).where(eq(stockLots.id, lot.id));
    if (here) {
      await this.stock.record(tx, lot.id, 'adjust', { from: lot.locationId, who, guest, extra });
      return lot.id;
    }
    return this.land(tx, lot, dest, moving, who, guest, extra);
  }

  /** Pieces from `lot` arriving at `dest` as cut stock, and the move recorded. */
  private async land(
    tx: Executor,
    lot: LotRow,
    dest: LocationRow,
    pieces: Piece[],
    who: Actor | null,
    guest: string | null,
    extra: Record<string, unknown>,
  ): Promise<string> {
    const belongs = await this.stock.originAfter(tx, lot, dest);
    const destId = await this.stock.lots.put(
      tx,
      { partId: lot.partId, mode: 'cut', unit: null },
      dest.id,
      belongs,
      cutAmount(pieces),
      { note: null, lastCheckedAt: nowIso() },
    );
    await this.stock.record(tx, destId, 'move', {
      from: lot.locationId,
      to: dest.id,
      delta: pieces.length,
      who,
      guest,
      partId: lot.partId,
      originBefore: lot.originLocationId,
      extra,
    });
    return destId;
  }

  private async dest(tx: Executor, ref: string): Promise<LocationRow> {
    return this.locations.checkOpen(await this.locations.resolve(ref, tx), tx);
  }

  private async part(tx: Executor, partId: string) {
    const part = await one(
      tx
        .select({ name: parts.name, unitMassG: parts.unitMassG, cut: parts.cut })
        .from(parts)
        .where(eq(parts.id, partId)),
    );
    if (!part) throw invalid('stock.noLot', { id: partId });
    return part;
  }
}

const size = (p: Piece) => (p.length === 2 ? p[0]! * p[1]! : p[0]!);
