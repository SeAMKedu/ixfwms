import {
  formatAmount,
  formatPiece,
  normalizeCode,
  pickPiece,
  sizeInUnit,
  piecesIn,
  USABLE_UNIT_STATUSES,
  type Leftover,
  type LotView,
  type MakeBuildResult,
  type Piece,
} from '@ixfwms/domain';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { many, type Executor } from '../../db/client.js';
import { units } from '../../db/schema.js';
import { countAmount } from '../stock/amounts.js';
import type { Actor } from '../../lib/context.js';
import type { LocationRow } from '../locations/store.js';
import type { StockService } from '../stock/stock.js';
import type { UnitService } from '../units/units.js';

type Moved = Pick<MakeBuildResult, 'moved'>;
type Part = { id: string; name: string; unitMassG: number | null };

/** Free stock: not built into anything, not being carried, not lent out. */
const isFree = (l: LotView) =>
  !l.location.inBuild && l.location.kind !== 'in_transit' && !l.location.outOfLab;

/**
 * Puts parts into a build from free stock. Counted stock goes first (the fullest lot first, so a
 * list takes from as few places as it can), then weighed stock by piece mass and cut stock's
 * pieces; then any amount nobody counted, which can give any number and stays as it is.
 * With a size, each piece is cut: from the smallest piece it fits in, a total length or area,
 * or bars and sheets nobody measured. Returns how many couldn't be had.
 */
export class BuildFill {
  constructor(
    private readonly stock: StockService,
    private readonly units: UnitService,
  ) {}

  /** Usable units that are free, one by one (`from`: only that one). */
  async putUnits(
    tx: Executor,
    partId: string,
    build: LocationRow,
    wanted: number,
    who: Actor,
    result: Moved,
    from: string | null = null,
  ): Promise<number> {
    const rows = await many(
      tx
        .select()
        .from(units)
        .where(and(eq(units.partId, partId), inArray(units.status, USABLE_UNIT_STATUSES)))
        .orderBy(asc(units.name), asc(units.code)),
    );
    const briefs = await this.units.briefs(rows, tx);
    let need = wanted;
    for (const [i, unit] of rows.entries()) {
      const brief = briefs[i]!;
      if (need === 0) break;
      if (brief.loan || brief.location.inBuild || brief.location.kind !== 'normal') continue;
      if (from && unit.id !== from && unit.code !== normalizeCode(from)) continue;
      await this.units.moveWithin(tx, unit, build.id, who);
      result.moved.push({
        name: brief.name,
        display: formatAmount(countAmount(1)),
        from: brief.location,
      });
      need--;
    }
    return need;
  }

  async putStock(
    tx: Executor,
    part: Part,
    build: LocationRow,
    wanted: number,
    who: Actor,
    result: Moved,
    opts: { from?: string | null; size?: Piece | null; leftover?: Leftover | null } = {},
  ): Promise<number> {
    const levels = await this.stock.levels();
    const lots = async () =>
      (await this.stock.lotsOfPart(part.id, tx)).filter(
        (l) => isFree(l) && (!opts.from || l.id === opts.from),
      );
    if (opts.size) {
      const size = opts.size;
      let need = wanted;
      for (; need > 0; need--) {
        const lot = cutSource(await lots(), size, levels);
        if (!lot) break;
        await this.stock.pieces.move(
          tx,
          lot.id,
          build.id,
          { cut: { size, leftover: opts.leftover } },
          who,
        );
        result.moved.push({ name: part.name, display: formatPiece(size), from: lot.location });
      }
      return need;
    }
    const order = (l: LotView) => {
      const n = piecesIn(l.amount, part.unitMassG, levels);
      return n == null ? -1 : n;
    };
    let need = wanted;
    for (const lot of (await lots()).sort((a, b) => kind(a) - kind(b) || order(b) - order(a))) {
      if (need === 0) break;
      const have = piecesIn(lot.amount, part.unitMassG, levels);
      if (have === 0) continue;
      const take = have == null ? need : Math.min(need, have);
      await this.stock.pieces.move(tx, lot.id, build.id, { pieces: take }, who);
      result.moved.push({
        name: part.name,
        display: formatAmount(countAmount(take)),
        from: lot.location,
      });
      need -= take;
    }
    return need;
  }
}

/** Counted first, then weighed, then cut stock's whole pieces, then amounts nobody counted. */
const kind = (l: LotView) =>
  ({ count: 0, measure: 1, cut: 2, level: 3 })[l.amount.mode] + (l.amount.quantity == null ? 3 : 0);

/** Where to cut `size` from: the smallest piece it fits in, a total that's long or big enough, or bars nobody measured. */
function cutSource(lots: LotView[], size: Piece, levels: Parameters<typeof piecesIn>[2]) {
  let best: { lot: LotView; area: number } | undefined;
  for (const lot of lots.filter((l) => l.amount.mode === 'cut')) {
    const pieces = lot.amount.pieces ?? [];
    const i = pickPiece(pieces, size);
    if (i < 0) continue;
    const area = pieces[i]!.reduce((a, b) => a * b, 1);
    if (!best || area < best.area) best = { lot, area };
  }
  if (best) return best.lot;
  const total = lots.find((l) => {
    const less = sizeInUnit(l.amount, size);
    return less != null && less <= l.amount.quantity!;
  });
  if (total) return total;
  return lots.find(
    (l) =>
      l.amount.mode !== 'cut' &&
      sizeInUnit(l.amount, size) == null &&
      piecesIn(l.amount, null, levels) !== 0,
  );
}
