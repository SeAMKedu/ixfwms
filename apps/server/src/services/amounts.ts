import {
  isUnknown,
  type AmountInput,
  type StockAmount,
  type StockLevelDef,
  type StockMode,
} from '@ixfwms/domain';
import type { stockLots } from '../db/schema.js';
import { invalid } from '../lib/errors.js';

type LotRow = typeof stockLots.$inferSelect;

export function amountOf(
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

/** An amount as given; `uncounted` leaves the quantity or level empty (see isUnknown). */
export function toAmount(input: AmountInput): StockAmount {
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
): Pick<StockAmount, 'quantity' | 'level'> {
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
