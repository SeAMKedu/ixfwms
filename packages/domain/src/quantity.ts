import { cutsFrom, formatPieces, type Piece } from './cut.js';
import { fold } from './names.js';

/** count: pieces; measure: weight, length, area or volume; level: plenty/low/empty; cut: pieces with sizes (see cut.ts). */
export const STOCK_MODES = ['count', 'measure', 'level', 'cut'] as const;
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

export const MEASURE_UNITS = ['g', 'kg', 'm', 'mm', 'm2', 'ml', 'l'] as const;
export type MeasureUnit = (typeof MEASURE_UNITS)[number];

/** What each unit measures, and how many of that measure's base unit it is. */
const UNIT_SCALE: Record<MeasureUnit, [measure: string, base: number]> = {
  g: ['mass', 1],
  kg: ['mass', 1000],
  mm: ['length', 0.001],
  m: ['length', 1],
  m2: ['area', 1],
  ml: ['volume', 0.001],
  l: ['volume', 1],
};

/** What one `from` is in `to` (1 kg is 1000 g); null when they measure different things. */
export function unitFactor(from: MeasureUnit, to: MeasureUnit): number | null {
  const [a, x] = UNIT_SCALE[from];
  const [b, y] = UNIT_SCALE[to];
  return a === b ? x / y : null;
}

/** The unit an item's minimum stock is in: its container's, or pieces (null). */
export const minStockUnit = (container: Container | null | undefined): MeasureUnit | null =>
  container?.unit ?? null;

/** How a unit is written: m2 is "m²". */
export const unitLabel = (unit: MeasureUnit | null | undefined): string =>
  unit === 'm2' ? 'm²' : (unit ?? '');

export interface StockAmount {
  mode: StockMode;
  /** Pieces for `count`, amount in `unit` for `measure`, null for `level`. */
  quantity: number | null;
  unit: MeasureUnit | null;
  level: StockLevel | null;
  /** `cut`: the pieces, in mm (quantity is how many). */
  pieces?: Piece[] | null;
}

const TO_GRAMS: Partial<Record<MeasureUnit, number>> = { g: 1, kg: 1000 };

/** Weights are what a scale can give, and what a container's weight comes off. */
export const isWeight = (unit: MeasureUnit | null | undefined): boolean =>
  unit != null && TO_GRAMS[unit] != null;

/**
 * What an item comes in: a spool, reel, box or bottle. Its empty weight comes off when it is
 * weighed with what's in it, and what a full one holds lets stock be added as "3 spools".
 */
export interface Container {
  /** What people call it: "spool", "reel", "box". */
  name: string | null;
  /** The empty container, in grams. */
  massG: number | null;
  /** How much a full one holds, in `unit`; pieces when `unit` is null. */
  holds: number | null;
  unit: MeasureUnit | null;
}

/** Floating point leftovers off: 1.18 kg less 200 g is 0.98 kg, not 0.9799999999999999. */
const tidy = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * A scale reading less the containers weighed with it, in the reading's unit. Null when the
 * unit isn't a weight; below zero when the containers weigh more than the reading.
 */
export function netOfReading(quantity: number, unit: MeasureUnit, tareG: number): number | null {
  const factor = TO_GRAMS[unit];
  return factor == null ? null : tidy((quantity * factor - tareG) / factor);
}

/** `n` full containers as an amount; null when the item doesn't say what a full one holds. */
export function fullAmount(container: Container | null | undefined, n: number): StockAmount | null {
  if (!container?.holds) return null;
  const quantity = tidy(container.holds * n);
  return container.unit
    ? { mode: 'measure', quantity, unit: container.unit, level: null }
    : { mode: 'count', quantity, unit: null, level: null };
}

/** Estimated piece count of a weighed lot ("312 g ≈ 260 pcs"), or null when it can't be estimated. */
export function estimateCount(
  amount: StockAmount,
  unitMassG: number | null | undefined,
): number | null {
  if (amount.mode === 'count') return amount.quantity;
  if (amount.mode !== 'measure' || amount.quantity == null || amount.unit == null) return null;
  const factor = TO_GRAMS[amount.unit];
  if (factor == null || !unitMassG || unitMassG <= 0) return null;
  return Math.max(0, Math.round((amount.quantity * factor) / unitMassG));
}

/**
 * Not counted yet: there is stock, but nobody has said how much (no quantity, or no level).
 * It counts as in stock and never as low; merging with it stays unknown; a stocktake ends it.
 */
export function isUnknown(amount: Pick<StockAmount, 'mode' | 'quantity' | 'level'>): boolean {
  if (amount.mode === 'cut') return false;
  return amount.mode === 'level' ? amount.level == null : amount.quantity == null;
}

/**
 * How many whole pieces a lot can give, as far as anyone knows: counted pieces, weighed ones by
 * piece mass, a cut lot's pieces; 0 when it's empty. Null when the amount doesn't say (a level,
 * stock nobody counted, a length or volume): any number can come out of those, and they stay as
 * they are (a known count out of an unknown amount).
 */
export function piecesIn(
  amount: StockAmount,
  unitMassG: number | null | undefined,
  levels: StockLevelDef[] = DEFAULT_STOCK_LEVELS,
): number | null {
  if (amount.mode === 'level')
    return amount.level != null && levelState(amount.level, levels) === 'empty' ? 0 : null;
  if (amount.mode === 'cut') return amount.pieces?.length ?? amount.quantity ?? 0;
  if (amount.quantity == null) return null;
  if (amount.mode === 'count') return amount.quantity;
  return estimateCount(amount, unitMassG);
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
      return `${amount.quantity ?? '?'} ${unitLabel(amount.unit)}`.trim();
    case 'level':
      return amount.level ?? 'unknown';
    case 'cut':
      return formatPieces(amount.pieces ?? []);
  }
}

/** How much a piece takes off a total: metres or millimetres of length, square metres of sheet. */
export function sizeInUnit(amount: StockAmount, size: Piece): number | null {
  if (amount.mode !== 'measure' || amount.quantity == null) return null;
  if (size.length === 1)
    return amount.unit === 'm' ? size[0]! / 1000 : amount.unit === 'mm' ? size[0]! : null;
  return amount.unit === 'm2' ? (size[0]! * size[1]!) / 1e6 : null;
}

/** Pieces of `size` a lot could give: cut from its pieces or its total; null when nobody measured it. */
export function cutsIn(
  amount: StockAmount,
  size: Piece,
  levels: StockLevelDef[] = DEFAULT_STOCK_LEVELS,
): number | null {
  if (amount.mode === 'cut')
    return (amount.pieces ?? []).reduce((n, p) => n + cutsFrom(p, size), 0);
  const per = sizeInUnit(amount, size);
  if (per != null) return Math.floor(amount.quantity! / per);
  return piecesIn(amount, null, levels) === 0 ? 0 : null;
}
