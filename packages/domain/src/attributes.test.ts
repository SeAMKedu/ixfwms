import { describe, expect, it } from 'vitest';
import { effectiveFields, formatAttributeFilter, parseAttributeFilter } from './attributes.js';

describe('attribute filters', () => {
  it('parses equality, contains and numeric ranges', () => {
    expect(parseAttributeFilter('thread:M4')).toEqual({ key: 'thread', op: 'eq', value: 'M4' });
    expect(parseAttributeFilter('lengthMm >= 10')).toEqual({
      key: 'lengthMm',
      op: 'gte',
      value: 10,
    });
    expect(parseAttributeFilter('diameterMm<=2,5')).toEqual({
      key: 'diameterMm',
      op: 'lte',
      value: 2.5,
    });
    expect(parseAttributeFilter('material~a2')).toEqual({
      key: 'material',
      op: 'contains',
      value: 'a2',
    });
  });

  it('rejects malformed filters and round-trips valid ones', () => {
    expect(parseAttributeFilter('lengthMm>=long')).toBeNull();
    expect(parseAttributeFilter('2bad:1')).toBeNull();
    expect(formatAttributeFilter({ key: 'lengthMm', op: 'gte', value: 10 })).toBe('lengthMm>=10');
  });
});

describe('effectiveFields', () => {
  it('inherits parent fields and lets children override them', () => {
    const fields = effectiveFields([
      [{ key: 'thread', label: 'Thread', type: 'text' }],
      [
        { key: 'thread', label: 'Thread (metric)', type: 'enum', options: ['M3'] },
        { key: 'lengthMm', label: 'Length', type: 'number', unit: 'mm' },
      ],
    ]);
    expect(fields.map((f) => f.label)).toEqual(['Thread (metric)', 'Length']);
  });
});
