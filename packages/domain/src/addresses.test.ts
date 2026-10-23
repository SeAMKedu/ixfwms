import { describe, expect, it } from 'vitest';
import { addressOf, autoShortName, nextShortName } from './addresses.js';

describe('short names', () => {
  it('guesses a short name from the name', () => {
    expect(autoShortName('Cabinet A')).toBe('A');
    expect(autoShortName('Shelf 3 · pneumatics')).toBe('3');
    expect(autoShortName('Shelf 12 (top)')).toBe('12');
    expect(autoShortName('A140.1')).toBe('A140.1');
    expect(autoShortName('Robolab')).toBe('Robolab');
    expect(autoShortName('Robotics lab')).toBe('RL');
    expect(autoShortName('Robot cell 2')).toBe('2');
    expect(autoShortName('Hyllykkö ä')).toBe('Ä');
  });

  it('steps on for copies', () => {
    expect(nextShortName('A')).toBe('B');
    expect(nextShortName('09')).toBe('10');
    expect(nextShortName('C2')).toBe('C3');
    expect(nextShortName('Z')).toBe('Z2');
  });
});

describe('addresses', () => {
  const fixed = (name: string, shortName: string | null = null) => ({
    name,
    shortName,
    movable: false,
  });
  it('joins fixed places and leaves movable containers out', () => {
    const lab = fixed('Robotics lab', 'Robolab');
    const shelf = [lab, fixed('Cabinet A'), fixed('Shelf C')];
    expect(addressOf(shelf)).toEqual({ parent: 'Robolab-A', short: 'C', address: 'Robolab-A-C' });
    const box = { name: 'Screws M4', shortName: 'B7', movable: true };
    expect(addressOf([...shelf, box])).toEqual({
      parent: 'Robolab-A-C',
      short: 'B7',
      address: 'B7',
    });
    // Something fixed inside a box (a divider) still gets the fixed address around it.
    expect(addressOf([...shelf, box, fixed('Slot 2')]).address).toBe('Robolab-A-C-2');
    expect(addressOf([lab]).address).toBe('Robolab');
    // A container without a set short name has none.
    expect(addressOf([...shelf, { ...box, shortName: null }])).toEqual({
      parent: 'Robolab-A-C',
      short: '',
      address: '',
    });
  });
});
