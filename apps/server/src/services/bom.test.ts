import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

const base = { tags: [], attributes: {}, status: 'active' as const };

describe('BOM check', () => {
  it('matches by order number, code and name, and counts complete sets', async () => {
    const { parts, locations, bom } = env.services;
    const box = await locations.create({ name: 'Box', type: 'box' }, env.admin);
    const at = (amount: object) => ({ location: box.code, amount: amount as never });
    const cup = await parts.create(
      {
        ...base,
        name: 'Bellows suction cup 30 NBR',
        identifiers: [{ kind: 'order_no', value: 'SPB1 30 NBR-60 G1/4-IG' }],
        stock: at({ mode: 'count', quantity: 10 }),
      },
      env.admin,
    );
    const ejector = await parts.create(
      {
        ...base,
        name: 'Vacuum generator VN-10',
        identifiers: [],
        stock: at({ mode: 'count', quantity: 1 }),
      },
      env.admin,
    );
    await parts.create(
      {
        ...base,
        name: 'Socket head screw M4x12',
        identifiers: [],
        unitMassG: 1.2,
        stock: at({ mode: 'measure', quantity: 36, unit: 'g' }),
      },
      env.admin,
    );
    await parts.create(
      {
        ...base,
        name: 'Push-in fitting 6 mm',
        identifiers: [],
        stock: at({ mode: 'level', level: 'plenty' }),
      },
      env.admin,
    );

    const result = await bom.check([
      { ref: 'spb1 30 nbr-60 g1/4-ig', quantity: 4 },
      { ref: ejector.code.toLowerCase(), quantity: 1 },
      { name: 'socket head screw M4x12', quantity: 8 },
      { name: 'push-in fitting 6 mm', quantity: 4 },
    ]);
    expect(result.lines.map((l) => [l.match, l.status, l.available])).toEqual([
      ['exact', 'ok', 10],
      ['exact', 'ok', 1],
      ['similar', 'ok', 30],
      ['similar', 'unknown', 0],
    ]);
    expect(result.lines[0]!.where[0]).toMatchObject({ code: box.code, display: '10 pcs' });
    expect(result.buildable).toBeNull();
    expect(result.missing).toBe(0);

    const counted = await bom.check([
      { ref: cup.code, quantity: 4 },
      { ref: ejector.code, quantity: 1 },
    ]);
    expect(counted.buildable).toBe(1);
    const missing = await bom.check([
      { ref: '6ES7 214-1AG40-0XB0', quantity: 1 },
      { ref: cup.code, quantity: 20 },
    ]);
    expect(missing.lines.map((l) => l.status)).toEqual(['missing', 'short']);
    expect(missing).toMatchObject({ buildable: 0, missing: 1, short: 1 });

    expect(await bom.tagProject([cup.code, ejector.code], 'Gripper v3', env.inventory)).toBe(2);
    expect((await parts.search({ tag: 'gripper v3', limit: 10, offset: 0 })).total).toBe(2);
  });
});
