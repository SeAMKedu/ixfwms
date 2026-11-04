import { describe, expect, it } from 'vitest';
import { AmountInput } from './amount-input.js';

describe('AmountInput', () => {
  it('takes full containers alone', () => {
    expect(AmountInput.safeParse({ full: 2 }).success).toBe(true);
    expect(AmountInput.safeParse({ full: 2, quantity: 5 }).success).toBe(false);
    expect(AmountInput.safeParse({ full: 1.5 }).success).toBe(false);
  });

  it('takes a container weight only off a weight', () => {
    const weighed = { mode: 'measure', quantity: 1180, unit: 'g', tareG: 200 };
    expect(AmountInput.safeParse(weighed).success).toBe(true);
    expect(AmountInput.safeParse({ ...weighed, unit: 'm' }).success).toBe(false);
    expect(AmountInput.safeParse({ ...weighed, quantity: 150 }).success).toBe(false);
  });
});
