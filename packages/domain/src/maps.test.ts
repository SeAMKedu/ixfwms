import { describe, expect, it } from 'vitest';
import { codeFromElementId, scanSvgCodes } from './maps.js';

describe('map element ids', () => {
  it('reads loc:, loc- and loc_ ids, case-insensitively', () => {
    expect(codeFromElementId('loc:A3F9')).toBe('A3F9');
    expect(codeFromElementId('loc-a3f9')).toBe('A3F9');
    expect(codeFromElementId('LOC_K7Q2')).toBe('K7Q2');
    expect(codeFromElementId('location:A3F9')).toBeNull();
    expect(codeFromElementId('loc:!!')).toBeNull();
  });

  it('finds every linked code once in an SVG document', () => {
    const svg = `<svg><rect id="loc:A3F9"/><g id='loc-K7Q2'><rect id="loc:A3F9"/></g><text id="title">Lab</text></svg>`;
    expect(scanSvgCodes(svg)).toEqual(['A3F9', 'K7Q2']);
  });
});
