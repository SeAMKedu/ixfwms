import { describe, expect, it } from 'vitest';
import { toAmountInput, type AmountState } from './amount-fields';

const state = (over: Partial<AmountState>): AmountState => ({
  mode: 'count',
  quantity: '',
  unit: 'g',
  level: 'plenty',
  tare: '',
  containers: '',
  uncounted: false,
  pieces: '',
  shape: 'length',
  ...over,
});

describe('amount fields', () => {
  it('never reads a blank quantity as zero or as uncounted', () => {
    expect(toAmountInput(state({}))).toBeNull();
    expect(toAmountInput(state({ mode: 'measure' }))).toBeNull();
    expect(toAmountInput(state({ quantity: '0' }))).toEqual({ mode: 'count', quantity: 0 });
  });

  it('sends "Not counted" only when it is ticked, whatever was typed', () => {
    expect(toAmountInput(state({ uncounted: true, quantity: '12' }))).toEqual({
      mode: 'count',
      uncounted: true,
    });
    expect(toAmountInput(state({ mode: 'measure', unit: 'm', uncounted: true }))).toEqual({
      mode: 'measure',
      unit: 'm',
      uncounted: true,
    });
    expect(toAmountInput(state({ mode: 'level', uncounted: true }))).toEqual({
      mode: 'level',
      uncounted: true,
    });
  });

  it('reads cut stock as pieces with sizes, and refuses a size that is not one', () => {
    expect(toAmountInput(state({ mode: 'cut', pieces: '6000, 2 x 400' }))).toEqual({
      mode: 'cut',
      pieces: [[6000], [400], [400]],
    });
    expect(
      toAmountInput(state({ mode: 'cut', shape: 'sheet', pieces: '1250x2500; 600 × 400' })),
    ).toEqual({
      mode: 'cut',
      pieces: [
        [1250, 2500],
        [600, 400],
      ],
    });
    expect(toAmountInput(state({ mode: 'cut', shape: 'sheet', pieces: '1250' }))).toBeNull();
  });

  it('weighs with the containers on and adds full ones by number', () => {
    const spool = { name: 'spool', massG: 200, holds: 1000, unit: 'g' as const };
    const weighed = state({ mode: 'measure', quantity: '1180', containers: '1' });
    expect(toAmountInput(weighed, spool)).toEqual({
      mode: 'measure',
      quantity: 1180,
      unit: 'g',
      tareG: 200,
    });
    // Without the item's own weight, the containers' weight is typed.
    expect(toAmountInput({ ...weighed, tare: '150' })).toMatchObject({ tareG: 150 });
    expect(toAmountInput({ ...weighed, quantity: '150' }, spool)).toBeNull();
    expect(toAmountInput(state({ mode: 'full', containers: '3' }), spool)).toEqual({
      mode: 'count',
      full: 3,
    });
    expect(toAmountInput(state({ mode: 'full', containers: '1.5' }), spool)).toBeNull();
  });
});
