import { describe, expect, it } from 'vitest';
import { nextFreeName, nextName } from './names.js';

describe('nextName', () => {
  it('counts up numbers, keeping leading zeros', () => {
    expect(nextName('Shelf 9')).toBe('Shelf 10');
    expect(nextName('Box 07')).toBe('Box 08');
    expect(nextName('Cabinet A')).toBe('Cabinet B');
    expect(nextName('Drawer')).toBe('Drawer 2');
    expect(nextName('Cabinet Z')).toBe('Cabinet Z 2');
  });

  it('skips names already used', () => {
    expect(nextFreeName('Cabinet A', ['Cabinet A', 'cabinet b'])).toBe('Cabinet C');
  });
});
