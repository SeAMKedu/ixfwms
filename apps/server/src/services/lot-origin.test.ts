import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

const draft = { identifiers: [], tags: [], attributes: {}, status: 'draft' as const };

/** Two shelves with the same screws, a workstation, and another storage box. */
async function lab() {
  const { locations, parts, stock } = env.services;
  const shelf3 = await locations.create({ name: 'Shelf 3', type: 'shelf' }, env.admin);
  const shelf5 = await locations.create({ name: 'Shelf 5', type: 'shelf' }, env.admin);
  const bench = await locations.create({ name: 'Workbench', type: 'workstation' }, env.admin);
  const box = await locations.create({ name: 'Box', type: 'box' }, env.admin);
  const screw = await parts.create(
    {
      ...draft,
      name: 'M3x10',
      stock: { location: shelf3.code, amount: { mode: 'count', quantity: 50 } },
    },
    env.admin,
  );
  const atShelf5 = await stock.add(
    { part: screw.code, location: shelf5.code, amount: { mode: 'count', quantity: 30 } },
    env.admin,
  );
  return { shelf3, shelf5, bench, box, screw, lot3: screw.lots[0]!, lot5: atShelf5 };
}

const lotsOf = async (code: string) =>
  (await env.services.parts.get(code)).lots
    .map((l) => [l.location.name, l.amount.quantity, l.origin?.name ?? null])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])) || Number(a[1]) - Number(b[1]));

describe('where stock came from', () => {
  it('keeps piles from different shelves apart on a bench, and clearing sends each home', async () => {
    const { bench, screw, lot3, lot5 } = await lab();
    const { stock, open } = env.services;
    await stock.move(lot3.id, bench.code, 10, env.admin);
    await stock.move(lot5.id, bench.code, 4, env.admin);
    expect(await lotsOf(screw.code)).toEqual([
      ['Shelf 3', 40, null],
      ['Shelf 5', 26, null],
      ['Workbench', 4, 'Shelf 5'],
      ['Workbench', 10, 'Shelf 3'],
    ]);

    // Someone without an account clears the bench and gives a name.
    const cleared = await open.clear(bench.code, 'Pekka', null);
    expect(cleared.returned.map((r) => r.to.name).sort()).toEqual(['Shelf 3', 'Shelf 5']);
    expect(await lotsOf(screw.code)).toEqual([
      ['Shelf 3', 50, null],
      ['Shelf 5', 30, null],
    ]);
    const moves = await env.database.client.execute(
      'SELECT reporter_name, note FROM stock_movements WHERE reporter_name IS NOT NULL',
    );
    expect(moves.rows.map((r) => [r.reporter_name, r.note])).toEqual([
      ['Pekka', null],
      ['Pekka', null],
    ]);
  });

  it('remembers the shelf through carrying, and an ordinary place becomes a new home', async () => {
    const { shelf3, bench, box, screw, lot3 } = await lab();
    const { carry, stock } = env.services;

    // Picked up and put down on the bench: still from Shelf 3. Carried back: home again.
    await carry.pick({ lotId: lot3.id, quantity: 5 }, env.admin);
    await carry.drop(bench.code, null, env.admin);
    let onBench = (await env.services.parts.get(screw.code)).lots.find(
      (l) => l.location.code === bench.code,
    )!;
    expect(onBench.origin?.code).toBe(shelf3.code);
    await carry.pick({ lotId: onBench.id }, env.admin);
    await carry.drop(shelf3.code, null, env.admin);
    expect(await lotsOf(screw.code)).toEqual([
      ['Shelf 3', 50, null],
      ['Shelf 5', 30, null],
    ]);

    // Into a box on a shelf: that's where they live now, and they merge with what's there.
    await stock.move(lot3.id, box.code, 20, env.admin);
    await stock.move(lot3.id, box.code, 5, env.admin);
    expect((await lotsOf(screw.code)).find((l) => l[0] === 'Box')).toEqual(['Box', 25, null]);
    onBench = (await stock.move(lot3.id, bench.code, 1, env.admin))!;
    expect(onBench.origin?.code).toBe(shelf3.code);
  });

  it('counts pieces in whole numbers', async () => {
    const { bench, screw, lot3 } = await lab();
    const { stock } = env.services;
    await expect(stock.take(lot3.id, 1.5, null, env.admin)).rejects.toThrow(/whole number/);
    await expect(stock.move(lot3.id, bench.code, 2.5, env.admin)).rejects.toThrow(/whole number/);
    await expect(
      stock.add({ part: screw.code, amount: { mode: 'count', quantity: 0.5 } }, env.admin),
    ).rejects.toThrow();
  });

  it('merges lots of duplicate parts that sit in the same place', async () => {
    const { shelf3, screw } = await lab();
    const { parts } = env.services;
    const dup = await parts.create(
      {
        ...draft,
        name: 'M3 x 10',
        stock: { location: shelf3.code, amount: { mode: 'count', quantity: 7 } },
      },
      env.admin,
    );
    await parts.mergeInto(dup.code, screw.code, env.admin);
    expect(await lotsOf(screw.code)).toEqual([
      ['Shelf 3', 57, null],
      ['Shelf 5', 30, null],
    ]);
  });
});
