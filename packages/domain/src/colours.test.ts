import { describe, expect, it } from 'vitest';
import { nearestColourName, toColourValue } from './colours.js';

describe('colour values', () => {
  it('accepts palette names, IEC codes and hex, and stores both name and hex', () => {
    expect(toColourValue('Blue')).toEqual({ name: 'blue', hex: '#1e64c8' });
    expect(toColourValue('BU')).toEqual({ name: 'blue', hex: '#1e64c8' });
    expect(toColourValue('gn/ye')).toEqual({ name: 'green-yellow', hex: '#9ccc3d' });
    expect(toColourValue('#3A6EA5')).toEqual({ name: 'blue', hex: '#3a6ea5' });
    expect(toColourValue('#fff')).toEqual({ name: 'white', hex: '#ffffff' });
  });

  it('keeps a chosen name with a custom shade, and handles empty input', () => {
    expect(toColourValue({ name: 'black', hex: '#2a2433' })).toEqual({
      name: 'black',
      hex: '#2a2433',
    });
    expect(toColourValue({ hex: '#c62828' })).toEqual({ name: 'red', hex: '#c62828' });
    expect(toColourValue('')).toBeNull();
    expect(toColourValue('galaxy purple')).toEqual({ name: 'galaxy purple', hex: '#9e9e9e' });
  });

  it('names shades by the nearest palette colour', () => {
    expect(nearestColourName('#ff8800')).toBe('orange');
    expect(nearestColourName('#101010')).toBe('black');
    expect(nearestColourName('#2e7d32')).toBe('green');
  });
});
