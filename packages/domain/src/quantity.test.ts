import { describe, expect, it } from 'vitest';
import { estimateCount, formatAmount, isCompatible, isEmpty } from './quantity.js';

describe('quantity', () => {
  it('estimates a count from weight, minus the tare', () => {
    expect(
      estimateCount({ mode: 'measure', quantity: 342, unit: 'g', level: null, tareG: 30 }, 1.2),
    ).toBe(260);
    expect(estimateCount({ mode: 'measure', quantity: 0.342, unit: 'kg', level: null }, 1.2)).toBe(
      285,
    );
  });

  it('returns null when no estimate is possible', () => {
    expect(estimateCount({ mode: 'measure', quantity: 2, unit: 'm', level: null }, 1)).toBeNull();
    expect(
      estimateCount({ mode: 'level', quantity: null, unit: null, level: 'low' }, 1),
    ).toBeNull();
  });

  it('knows which lots can merge', () => {
    expect(isCompatible({ mode: 'measure', unit: 'g' }, { mode: 'measure', unit: 'g' })).toBe(true);
    expect(isCompatible({ mode: 'measure', unit: 'g' }, { mode: 'measure', unit: 'm' })).toBe(
      false,
    );
    expect(isCompatible({ mode: 'count', unit: null }, { mode: 'level', unit: null })).toBe(false);
  });

  it('formats and detects empty stock', () => {
    expect(formatAmount({ mode: 'measure', quantity: 7.5, unit: 'm', level: null })).toBe('7.5 m');
    expect(isEmpty({ mode: 'level', quantity: null, unit: null, level: 'empty' })).toBe(true);
    expect(isEmpty({ mode: 'count', quantity: 3, unit: null, level: null })).toBe(false);
  });
});
