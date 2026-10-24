import { fold } from './names.js';

export const STOCK_MODES = ['count', 'measure', 'level'] as const;
export type StockMode = (typeof STOCK_MODES)[number];

/**
 * What a level means for stock checks: `ok` is in stock, `low` is in stock but should be
 * reordered, `empty` is out. The levels themselves (names, how many) are a lab setting.
 */
export const LEVEL_STATES = ['ok', 'low', 'empty'] as const;
export type LevelState = (typeof LEVEL_STATES)[number];

/** One stock level, e.g. { key: 'plenty', name: 'Plenty', state: 'ok' }. Stock stores the key. */
export interface StockLevelDef {
  key: string;
  name: string;
  state: LevelState;
}

/** A level's key, as stored on stock lots. */
export type StockLevel = string;

/** The levels a lab starts with, best first. */
export const DEFAULT_STOCK_LEVELS: StockLevelDef[] = [
  { key: 'plenty', name: 'Plenty', state: 'ok' },
  { key: 'low', name: 'Low', state: 'low' },
  { key: 'empty', name: 'Empty', state: 'empty' },
];

/** The state of a level key; unknown keys (a level since removed) count as low. */
export function levelState(
  key: string | null | undefined,
  levels: StockLevelDef[] = DEFAULT_STOCK_LEVELS,
): LevelState {
  return levels.find((l) => l.key === key)?.state ?? 'low';
}

/** Finds a level by key or name, case-insensitively ("Low", "low", "Puolillaan"). */
export function findLevel(text: string, levels: StockLevelDef[]): StockLevelDef | undefined {
  const t = fold(text.trim());
  return levels.find((l) => fold(l.key) === t || fold(l.name) === t);
}

/** "Half full" → "half_full": keys for new levels. */
export function levelKey(name: string, taken: string[]): string {
  const base =
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 30) || 'level';
  let key = base;
  for (let n = 2; taken.includes(key); n++) key = `${base}_${n}`;
  return key;
}

export const MEASURE_UNITS = ['g', 'kg', 'm', 'mm', 'ml', 'l'] as const;
export type MeasureUnit = (typeof MEASURE_UNITS)[number];

export interface StockAmount {
  mode: StockMode;
  /** Pieces for `count`, amount in `unit` for `measure`, null for `level`. */
  quantity: number | null;
  unit: MeasureUnit | null;
  level: StockLevel | null;
  /** Container weight to subtract when a lot is weighed. */
  tareG?: number | null;
}

const TO_GRAMS: Partial<Record<MeasureUnit, number>> = { g: 1, kg: 1000 };

/** Estimated piece count of a weighed lot ("312 g ≈ 260 pcs"), or null when it can't be estimated. */
export function estimateCount(
  amount: StockAmount,
  unitMassG: number | null | undefined,
): number | null {
  if (amount.mode === 'count') return amount.quantity;
  if (amount.mode !== 'measure' || amount.quantity == null || amount.unit == null) return null;
  const factor = TO_GRAMS[amount.unit];
  if (factor == null || !unitMassG || unitMassG <= 0) return null;
  const netG = amount.quantity * factor - (amount.tareG ?? 0);
  return Math.max(0, Math.round(netG / unitMassG));
}

/**
 * Not counted yet: there is stock, but nobody has said how much (no quantity, or no level).
 * It counts as in stock and never as low; merging with it stays unknown; a stocktake ends it.
 */
export function isUnknown(amount: Pick<StockAmount, 'mode' | 'quantity' | 'level'>): boolean {
  return amount.mode === 'level' ? amount.level == null : amount.quantity == null;
}

/** True when a lot should be considered out of stock. */
export function isEmpty(
  amount: StockAmount,
  levels: StockLevelDef[] = DEFAULT_STOCK_LEVELS,
): boolean {
  if (amount.mode === 'level') return levelState(amount.level, levels) === 'empty';
  return amount.quantity != null && amount.quantity <= 0;
}

/** Two lots can be merged when they are tracked the same way. */
export function isCompatible(
  a: Pick<StockAmount, 'mode' | 'unit'>,
  b: Pick<StockAmount, 'mode' | 'unit'>,
): boolean {
  if (a.mode !== b.mode) return false;
  return a.mode !== 'measure' || a.unit === b.unit;
}

export function formatAmount(amount: StockAmount): string {
  switch (amount.mode) {
    case 'count':
      return `${amount.quantity ?? '?'} pcs`;
    case 'measure':
      return `${amount.quantity ?? '?'} ${amount.unit ?? ''}`.trim();
    case 'level':
      return amount.level ?? 'unknown';
  }
}
