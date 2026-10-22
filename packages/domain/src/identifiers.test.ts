import { describe, expect, it } from 'vitest';
import { normalizeIdentifier } from './identifiers.js';

describe('normalizeIdentifier', () => {
  it('matches Siemens order numbers however they are written', () => {
    const variants = ['6ES7 214-1AG40-0XB0', '6es7214-1ag40-0xb0', '6ES72141AG400XB0'];
    expect(new Set(variants.map(normalizeIdentifier)).size).toBe(1);
  });

  it('treats the multiplication sign like x', () => {
    expect(normalizeIdentifier('DIN 912 M4×12')).toBe(normalizeIdentifier('din912 m4x12'));
  });
});
