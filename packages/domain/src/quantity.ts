export const STOCK_MODES = ['count', 'measure', 'level'] as const;
export type StockMode = (typeof STOCK_MODES)[number];

export const STOCK_LEVELS = ['plenty', 'low', 'empty'] as const;
export type StockLevel = (typeof STOCK_LEVELS)[number];

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

/** True when a lot should be considered out of stock. */
export function isEmpty(amount: StockAmount): boolean {
  if (amount.mode === 'level') return amount.level === 'empty';
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
