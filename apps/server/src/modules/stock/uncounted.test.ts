import { AmountInput } from '@ixfwms/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

const active = { status: 'active' as const };

/** A shelf and a box, and screws on the shelf that nobody has counted. */
async function lab() {
  const { locations, parts } = env.services;
  const shelf = await locations.create({ name: 'Shelf 3', type: 'shelf' }, env.admin);
  const box = await locations.create({ name: 'Box', type: 'box' }, env.admin);
  const screw = await parts.create(
    {
      ...active,
      name: 'M3x10',
      minStock: 100,
      stock: { location: shelf.code, amount: { mode: 'count', uncounted: true } },
    },
    env.admin,
  );
  return { shelf, box, screw, lot: screw.lots[0]! };
}

const codes = async (input: object) =>
  (await env.services.parts.search({ limit: 50, offset: 0, ...input })).items.map((p) => p.code);

describe('stock nobody has counted', () => {
  it('is said on purpose: a missing quantity is still an error', () => {
    expect(AmountInput.safeParse({ mode: 'count' }).success).toBe(false);
    expect(AmountInput.safeParse({ mode: 'count', uncounted: true }).success).toBe(true);
    expect(AmountInput.safeParse({ mode: 'count', quantity: 3, uncounted: true }).success).toBe(
      false,
    );
    expect(AmountInput.safeParse({ mode: 'measure', uncounted: true }).success).toBe(false);
    expect(AmountInput.safeParse({ mode: 'level', uncounted: true }).success).toBe(true);
  });

  it('stays unknown when added to or taken from, until a stocktake counts it', async () => {
    const { shelf, screw, lot } = await lab();
    const { stock } = env.services;
    expect([lot.display, lot.lastCheckedAt]).toEqual(['? pcs', null]);
    const merged = await stock.add(
      { part: screw.code, location: shelf.code, amount: { mode: 'count', quantity: 5 } },
      env.admin,
    );
    expect([merged.id, merged.amount.quantity]).toEqual([lot.id, null]);
    // Counted stock joining uncounted stays unchecked; uncounted joining counted unchecks it.
    expect(merged.lastCheckedAt).toBeNull();
    expect((await stock.take(lot.id, 2, null, env.admin)).amount.quantity).toBeNull();
    await expect(stock.take(lot.id, 1.5, null, env.admin)).rejects.toThrow(/whole number/);
    await expect(
      stock.stocktake(lot.id, { mode: 'count', uncounted: true }, env.admin),
    ).rejects.toThrow(/give the amount/);
    expect(
      (await stock.stocktake(lot.id, { mode: 'count', quantity: 40 }, env.admin)).amount.quantity,
    ).toBe(40);
  });

  it('gives a known count and stays uncounted, or moves as a whole', async () => {
    const { box, lot } = await lab();
    const { stock } = env.services;
    const three = await stock.move(lot.id, box.code, 3, env.admin);
    expect([three.location.name, three.amount.quantity]).toEqual(['Box', 3]);
    expect((await stock.view(env.database.db, lot.id)).amount.quantity).toBeNull();
    const moved = await stock.move(lot.id, box.code, null, env.admin);
    expect([moved.location.name, moved.amount.quantity]).toEqual(['Box', null]);
  });

  it("can't undo a move once uncounted stock has joined it", async () => {
    const { box, screw } = await lab();
    const { history, locations, stock } = env.services;
    const shelf5 = await locations.create({ name: 'Shelf 5', type: 'shelf' }, env.admin);
    const counted = await stock.add(
      { part: screw.code, location: shelf5.code, amount: { mode: 'count', quantity: 10 } },
      env.admin,
    );
    await stock.move(counted.id, box.code, null, env.admin);
    const move = (await history.recent(env.admin)).find((e) => e.kind === 'stock' && e.undoable)!;
    const joined = await stock.add(
      { part: screw.code, location: box.code, amount: { mode: 'count', uncounted: true } },
      env.admin,
    );
    expect([joined.amount.quantity, joined.lastCheckedAt]).toEqual([null, null]);
    await expect(history.undo('stock', move.id, env.admin)).rejects.toThrow(/changed since/);
  });

  it('counts as in stock, never as low, and can be listed for counting', async () => {
    const { screw } = await lab();
    const { parts } = env.services;
    const bin = await parts.create(
      { ...active, name: 'Cable ties', stock: { amount: { mode: 'level', uncounted: true } } },
      env.admin,
    );
    const counted = await parts.create(
      { ...active, name: 'Washers', stock: { amount: { mode: 'count', quantity: 3 } } },
      env.admin,
    );
    expect((await codes({ inStock: true })).sort()).toEqual(
      [screw.code, bin.code, counted.code].sort(),
    );
    // 0 counted pieces against a minimum of 100, but the uncounted lot may be plenty.
    expect(await codes({ lowStock: true })).toEqual([]);
    expect((await codes({ uncounted: true })).sort()).toEqual([screw.code, bin.code].sort());
  });

  it('may be enough for a build list: the check says it cannot tell', async () => {
    await lab();
    const result = await env.services.bom.check([{ name: 'M3x10', quantity: 8 }]);
    expect(result.lines.map((l) => [l.status, l.uncounted])).toEqual([['unknown', true]]);
  });

  it('comes from an import when a blank quantity is said to mean that', async () => {
    const run = (blankQuantity: 'none' | 'uncounted') =>
      env.services.import.importParts(
        [{ name: `Spacers (${blankQuantity})`, tags: [] }],
        { matchExisting: true, blankQuantity },
        env.inventory,
        false,
      );
    await run('none');
    await run('uncounted');
    const lots = async (q: string) =>
      (
        await env.services.parts.get(
          (await env.services.parts.search({ q, limit: 1, offset: 0 })).items[0]!.code,
        )
      ).lots.map((l) => l.display);
    expect(await lots('spacers (none)')).toEqual([]);
    expect(await lots('spacers (uncounted)')).toEqual(['? pcs']);
  });
});
