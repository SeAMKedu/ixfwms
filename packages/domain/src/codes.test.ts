import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, generateCode, isValidCode, normalizeCode } from './codes.js';

describe('codes', () => {
  it('generates valid codes of the requested length', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode(5);
      expect(code).toHaveLength(5);
      expect(isValidCode(code)).toBe(true);
    }
  });

  it('never uses ambiguous letters', () => {
    expect(CODE_ALPHABET).not.toMatch(/[ILOU]/);
  });

  it('normalises typed input', () => {
    expect(normalizeCode(' a3f9 ')).toBe('A3F9');
    expect(normalizeCode('ao-1l')).toBe('A011');
  });
});
