import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

describe('history and undo', () => {
  it('lists recent changes and puts moved stock and places back', async () => {
    const { locations, parts, stock, history, carry } = env.services;
    const shelf = await locations.create({ name: 'Shelf', type: 'shelf' }, env.admin);
    const cell = await locations.create({ name: 'Cell', type: 'zone' }, env.admin);
    const box = await locations.create({ name: 'Box', type: 'box', parent: shelf.code }, env.admin);
    const cup = await parts.create(
      {
        name: 'Cup',
        identifiers: [],
        tags: [],
        attributes: {},
        status: 'draft',
        stock: { location: shelf.code, amount: { mode: 'count', quantity: 10 } },
      },
      env.admin,
    );
    await stock.move(cup.lots[0]!.id, cell.code, 4, env.admin);
    await locations.move(box.code, cell.code, env.admin);

    const feed = await history.recent(20);
    expect(feed[0]).toMatchObject({
      kind: 'location',
      action: 'move',
      place: { name: 'Box' },
      from: { name: 'Shelf' },
      to: { name: 'Cell' },
      undoable: true,
    });
    const stockMove = feed.find((e) => e.kind === 'stock' && e.action === 'move')!;
    expect(stockMove).toMatchObject({
      part: { name: 'Cup' },
      delta: 4,
      user: 'admin',
      undoable: true,
    });
    expect(
      feed.some((e) => e.kind === 'edit' && e.action === 'create' && e.part?.name === 'Cup'),
    ).toBe(true);

    await history.undo('location', feed[0]!.id, env.inventory);
    expect((await env.services.locationViews.detail(box.code)).path.map((p) => p.name)).toEqual([
      'Shelf',
      'Box',
    ]);
    await expect(history.undo('location', feed[0]!.id, env.inventory)).rejects.toThrow(
      /moved again/,
    );

    await history.undo('stock', stockMove.id, env.inventory);
    expect((await parts.get(cup.code)).lots.map((l) => l.amount.quantity)).toEqual([10]);

    // Carry reminder lists people with something picked up.
    await carry.pick({ location: box.code }, env.admin);
    expect(await carry.everyone()).toEqual([expect.objectContaining({ user: 'admin', count: 1 })]);
  });
});
