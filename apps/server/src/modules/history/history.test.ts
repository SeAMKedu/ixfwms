import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../test/harness.js';

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

    const feed = await history.recent(env.admin, 20);
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
    expect(await carry.everyone(env.admin)).toEqual([
      expect.objectContaining({ user: 'admin', count: 1 }),
    ]);
  });
});

describe('units in the history', () => {
  it('lists unit moves and log entries, with the unit as the subject', async () => {
    const { locations, parts, units, history } = env.services;
    const shelf = await locations.create({ name: 'Shelf 3', type: 'shelf' }, env.admin);
    const bench = await locations.create({ name: 'Workbench', type: 'workstation' }, env.admin);
    const drill = await parts.create(
      { name: 'Impact drill', kind: 'tool', status: 'active' },
      env.admin,
    );
    const [unit] = await units.add(
      { part: drill.code, units: [{ name: 'Drill 2' }], home: shelf.code },
      env.admin,
    );
    await units.move(unit!.code, bench.code, env.admin);
    await units.log(
      unit!.code,
      { kind: 'firmware', value: '2.1.0', text: 'From the app' },
      env.admin,
    );

    const feed = await history.recent(env.admin, 20);
    expect(feed[0]).toMatchObject({
      kind: 'unit',
      action: 'firmware',
      unit: { code: unit!.code, name: 'Drill 2' },
      value: '2.1.0',
      text: 'From the app',
      user: 'admin',
    });
    expect(feed[1]).toMatchObject({
      kind: 'unit',
      action: 'moved',
      from: { name: 'Shelf 3' },
      to: { name: 'Workbench' },
    });
    // The audit rows for units stay out: the unit's own log says it better.
    expect(feed.filter((e) => e.kind === 'edit' && !e.part && !e.place)).toEqual([]);
  });
});

describe('category changes in the history', () => {
  it('shows renames as from → to, and deletions by name', async () => {
    const { categories, history } = env.services;
    await categories.setFields('Pneumatcs', [], env.admin);
    await categories.move('Pneumatcs', 'Pneumatics', env.admin);
    await categories.remove('Pneumatics', null, env.admin);
    const feed = await history.recent(env.admin, 5);
    const deleted = feed.find((e) => e.action === 'delete');
    const moved = feed.find((e) => e.action === 'move');
    expect(deleted).toMatchObject({
      kind: 'edit',
      action: 'delete',
      place: { name: 'Pneumatics' },
    });
    expect(moved).toMatchObject({
      action: 'move',
      place: { name: 'Pneumatcs' },
      from: { name: 'Pneumatcs' },
      to: { name: 'Pneumatics' },
    });
  });
});
