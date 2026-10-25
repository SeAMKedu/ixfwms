import {
  isUnknown,
  levelState,
  type CutShape,
  type Piece,
  type AmountInput,
  type StockAmount,
  type StockLevelDef,
  type StockMode,
} from '@ixfwms/domain';
import type { stockLots } from '../db/schema.js';
import { invalid } from '../lib/errors.js';

type LotRow = typeof stockLots.$inferSelect;

export function amountOf(
  lot: Pick<LotRow, 'mode' | 'quantity' | 'unit' | 'level' | 'tareG' | 'pieces'>,
): StockAmount {
  return {
    mode: lot.mode,
    quantity: lot.quantity,
    unit: lot.unit,
    level: lot.level,
    tareG: lot.tareG,
    pieces: lot.mode === 'cut' ? (lot.pieces ?? []) : null,
  };
}

/** A cut lot's amount: these pieces, and how many. */
export const cutAmount = (pieces: Piece[]): StockAmount => ({
  mode: 'cut',
  quantity: pieces.length,
  unit: null,
  level: null,
  pieces,
});

/** An amount as given; `uncounted` leaves the quantity or level empty (see isUnknown). */
export function toAmount(input: AmountInput): StockAmount {
  if (input.mode === 'cut') return cutAmount(input.pieces ?? []);
  const counted = !input.uncounted;
  return {
    mode: input.mode,
    quantity: input.mode === 'level' || !counted ? null : (input.quantity ?? null),
    unit: input.mode === 'measure' ? (input.unit ?? null) : null,
    level: input.mode === 'level' && counted ? (input.level ?? null) : null,
    tareG: input.tareG ?? null,
  };
}

/** Pieces are counted in whole numbers; weights and lengths may have decimals. */
export function checkWhole(mode: StockMode, quantity: number | null): void {
  if (mode === 'count' && quantity != null && !Number.isInteger(quantity))
    throw invalid('stock.notWhole', { quantity });
}

/**
 * Combines two compatible amounts: quantities add up, levels keep the better one (earlier in
 * the list). With an uncounted one the result isn't known either, until someone counts it.
 */
export function merge(
  into: StockAmount,
  add: StockAmount,
  levels: StockLevelDef[],
): Pick<StockAmount, 'quantity' | 'level' | 'pieces'> {
  if (into.mode === 'cut') {
    const pieces = [...(into.pieces ?? []), ...(add.pieces ?? [])];
    return { quantity: pieces.length, level: null, pieces };
  }
  if (isUnknown(into) || isUnknown(add)) return { quantity: null, level: null };
  if (into.mode === 'level') {
    const rank = (key: string | null) => {
      const i = levels.findIndex((l) => l.key === key);
      return i < 0 ? levels.length : i;
    };
    return { quantity: null, level: rank(add.level) < rank(into.level) ? add.level : into.level };
  }
  return { quantity: (into.quantity ?? 0) + (add.quantity ?? 0), level: null };
}

const TO_GRAMS: Partial<Record<string, number>> = { g: 1, kg: 1000 };

/** A count of pieces as an amount. */
export const countAmount = (n: number): StockAmount => ({
  mode: 'count',
  quantity: n,
  unit: null,
  level: null,
});

/**
 * `n` pieces in a lot's own unit, when it says: weighed stock with a known piece mass. Null for
 * anything else (levels, stock nobody counted, lengths, volumes, areas).
 */
export function piecesToUnit(
  amount: StockAmount,
  n: number,
  unitMassG: number | null,
): number | null {
  const factor = amount.mode === 'measure' ? TO_GRAMS[amount.unit ?? ''] : undefined;
  if (!factor || !unitMassG || amount.quantity == null) return null;
  return (n * unitMassG) / factor;
}

/**
 * Counted pieces coming back to an amount that doesn't count them: weighed stock with a known
 * piece mass gets their weight, an empty level becomes the lowest level that isn't empty, and
 * anything else (a level, stock nobody counted, a length or volume) stays as it is.
 */
export function absorb(
  into: StockAmount,
  n: number,
  unitMassG: number | null,
  levels: StockLevelDef[],
): Pick<StockAmount, 'quantity' | 'level'> {
  const extra = piecesToUnit(into, n, unitMassG);
  if (extra != null) return { quantity: into.quantity! + extra, level: null };
  if (into.mode === 'level' && into.level && levelState(into.level, levels) === 'empty') {
    const back = [...levels].reverse().find((l) => l.state !== 'empty');
    return { quantity: null, level: back?.key ?? into.level };
  }
  return { quantity: into.quantity, level: into.level };
}

/** A cut amount only for an item cut that way, with pieces of its shape. */
export function checkCut(part: { name: string; cut: CutShape | null }, amount: StockAmount): void {
  if (amount.mode !== 'cut') return;
  if (!part.cut) throw invalid('stock.notCutStock', { name: part.name });
  const n = part.cut === 'sheet' ? 2 : 1;
  if ((amount.pieces ?? []).some((p) => p.length !== n)) throw invalid('stock.wrongShape');
}
