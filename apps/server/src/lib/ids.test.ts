import { describe, expect, it } from 'vitest';
import { newId } from './ids.js';

describe('newId', () => {
  it('makes UUIDv7 ids that sort in the order they were made, also within a millisecond', () => {
    const ids = Array.from({ length: 5000 }, () => newId());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
