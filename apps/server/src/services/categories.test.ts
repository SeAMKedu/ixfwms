import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

const base = { identifiers: [], tags: [], status: 'draft' as const };

describe('category fields and searching on them', () => {
  it('inherits fields and finds screws by thread and length', async () => {
    const { parts } = env.services;
    expect((await parts.seedStarterCategories(env.admin)).length).toBeGreaterThan(5);
    const fields = await parts.categoryFields('fasteners/screws');
    expect(fields.path).toBe('Fasteners/Screws');
    expect(fields.effective.map((f) => f.key)).toEqual([
      'thread',
      'standard',
      'material',
      'lengthMm',
      'head',
    ]);

    await parts.create(
      {
        ...base,
        name: 'M4×12 socket',
        category: 'Fasteners/Screws',
        attributes: { thread: 'M4', lengthMm: 12, material: 'A2' },
      },
      env.admin,
    );
    await parts.create(
      {
        ...base,
        name: 'M4×30 socket',
        category: 'Fasteners/Screws',
        attributes: { thread: 'M4', lengthMm: 30 },
      },
      env.admin,
    );
    await parts.create(
      {
        ...base,
        name: 'M3×10 socket',
        category: 'Fasteners/Screws',
        attributes: { thread: 'M3', lengthMm: 10 },
      },
      env.admin,
    );

    const names = async (
      attributes: { key: string; op: 'eq' | 'gte' | 'lte' | 'contains'; value: string | number }[],
    ) => (await parts.search({ attributes, limit: 50, offset: 0 })).items.map((p) => p.name).sort();
    expect(await names([{ key: 'thread', op: 'eq', value: 'm4' }])).toEqual([
      'M4×12 socket',
      'M4×30 socket',
    ]);
    expect(
      await names([
        { key: 'thread', op: 'eq', value: 'M4' },
        { key: 'lengthMm', op: 'lte', value: 20 },
      ]),
    ).toEqual(['M4×12 socket']);
    expect(
      await names([
        { key: 'lengthMm', op: 'gte', value: 10 },
        { key: 'lengthMm', op: 'lte', value: 12 },
      ]),
    ).toEqual(['M3×10 socket', 'M4×12 socket']);
    expect(await names([{ key: 'material', op: 'contains', value: 'a' }])).toEqual([
      'M4×12 socket',
    ]);

    const detail = await parts.get(
      (await parts.search({ q: 'M4×12', limit: 1, offset: 0 })).items[0]!.code,
    );
    expect(detail.fields.find((f) => f.key === 'lengthMm')?.unit).toBe('mm');
  });

  it('only lets the write scope change fields, and rejects duplicate keys', async () => {
    const { parts } = env.services;
    const fields = [{ key: 'colour', label: 'Colour', type: 'text' as const }];
    await expect(parts.setCategoryFields('Filament', fields, env.inventory)).rejects.toThrow(
      /write/,
    );
    await expect(
      parts.setCategoryFields('Filament', [...fields, ...fields], env.admin),
    ).rejects.toThrow(/twice/);
    expect((await parts.setCategoryFields('Filament', fields, env.admin)).own).toHaveLength(1);
    expect(await parts.listCategories()).toEqual([{ path: 'Filament', parts: 0, fields: 1 }]);
  });
});

describe('low stock', () => {
  it('lists parts below their minimum or marked low/empty', async () => {
    const { parts } = env.services;
    const box = await env.services.locations.create({ name: 'Box', type: 'box' }, env.admin);
    const stock = (amount: object) => ({ location: box.code, amount: amount as never });
    await parts.create(
      {
        ...base,
        attributes: {},
        name: 'Few cups',
        minStock: 10,
        stock: stock({ mode: 'count', quantity: 3 }),
      },
      env.admin,
    );
    await parts.create(
      {
        ...base,
        attributes: {},
        name: 'Enough cups',
        minStock: 2,
        stock: stock({ mode: 'count', quantity: 3 }),
      },
      env.admin,
    );
    await parts.create(
      {
        ...base,
        attributes: {},
        name: 'Running out of M3',
        stock: stock({ mode: 'level', level: 'low' }),
      },
      env.admin,
    );
    await parts.create(
      { ...base, attributes: {}, name: 'No minimum', stock: stock({ mode: 'count', quantity: 0 }) },
      env.admin,
    );
    const low = await parts.search({ lowStock: true, limit: 50, offset: 0 });
    expect(low.items.map((p) => p.name).sort()).toEqual(['Few cups', 'Running out of M3']);
  });
});

describe('colour fields', () => {
  it('stores colours as name + hex and finds them by name', async () => {
    const { parts } = env.services;
    await parts.setCategoryFields(
      'Filament',
      [{ key: 'colour', label: 'Colour', type: 'colour' }],
      env.admin,
    );
    const black = await parts.create(
      {
        ...base,
        name: 'PETG Galaxy Black',
        category: 'Filament',
        attributes: { colour: '#2a2433' },
      },
      env.admin,
    );
    const blue = await parts.create(
      { ...base, name: 'PLA blue', category: 'Filament', attributes: { colour: 'BU' } },
      env.admin,
    );
    expect((await parts.get(black.code)).attributes.colour).toEqual({
      name: 'black',
      hex: '#2a2433',
    });
    expect((await parts.get(blue.code)).attributes.colour).toEqual({
      name: 'blue',
      hex: '#1e64c8',
    });
    await parts.update(
      blue.code,
      { attributes: { colour: { name: 'blue', hex: '#3a6ea5' } } },
      env.admin,
    );
    expect((await parts.get(blue.code)).attributes.colour).toEqual({
      name: 'blue',
      hex: '#3a6ea5',
    });
    const found = await parts.search({
      attributes: [{ key: 'colour', op: 'eq', value: 'Black' }],
      limit: 10,
      offset: 0,
    });
    expect(found.items.map((p) => p.name)).toEqual(['PETG Galaxy Black']);
  });
});
