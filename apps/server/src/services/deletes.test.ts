import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

const base = { identifiers: [], tags: [], attributes: {}, status: 'active' as const };

describe('deleting what was made by mistake', () => {
  it('deletes a typo item with its stock, and retires its code', async () => {
    const { locations, parts, deletes, labels } = env.services;
    const shelf = await locations.create({ name: 'Shelf 3', type: 'shelf' }, env.admin);
    const typo = await parts.create(
      {
        ...base,
        name: 'Hex nutt M3',
        stock: { location: shelf.code, amount: { mode: 'count', quantity: 5 } },
      },
      env.admin,
    );
    await expect(deletes.part(typo.code, env.inventory)).rejects.toThrow(/write/);
    await deletes.part(typo.code, env.admin);
    await expect(parts.get(typo.code)).rejects.toThrow(/not found/);
    const rows = await env.database.client.execute('SELECT count(*) AS n FROM stock_lots');
    expect(Number(rows.rows[0]!.n)).toBe(0);
    expect((await labels.lookup(typo.code)).retired?.note).toBe('deleted item Hex nutt M3');
  });

  it('deletes items that were moved or have units, with their units', async () => {
    const { locations, parts, stock, units, deletes, labels } = env.services;
    const shelf = await locations.create({ name: 'Shelf 3', type: 'shelf' }, env.admin);
    const box = await locations.create({ name: 'Box', type: 'box' }, env.admin);
    const moved = await parts.create(
      {
        ...base,
        name: 'Washer',
        stock: { location: shelf.code, amount: { mode: 'count', quantity: 5 } },
      },
      env.admin,
    );
    await stock.move(moved.lots[0]!.id, box.code, 2, env.admin);
    await deletes.part(moved.code, env.admin);
    await expect(parts.get(moved.code)).rejects.toThrow(/not found/);

    const drill = await parts.create({ ...base, name: 'Drill', kind: 'tool' }, env.admin);
    const [unit] = await units.add(
      { part: drill.code, units: [{ name: 'Drill 1' }], home: shelf.code },
      env.admin,
    );
    await units.move(unit!.code, box.code, env.admin);
    await deletes.part(drill.code, env.admin);
    await expect(units.resolve(unit!.code)).rejects.toThrow(/not found/);
    expect((await labels.lookup(unit!.code)).retired?.note).toBe('deleted unit Drill 1');
  });

  it('keeps what is in use: lent out or built in', async () => {
    const { locations, parts, units, builds, deletes } = env.services;
    const shelf = await locations.create({ name: 'Shelf 3', type: 'shelf' }, env.admin);
    const drill = await parts.create({ ...base, name: 'Drill', kind: 'tool' }, env.admin);
    const [unit] = await units.add(
      { part: drill.code, units: [{ name: 'Drill 1' }], home: shelf.code },
      env.admin,
    );

    // Lent out it stays; marked lost (it never came back) it can go, and the item too.
    await env.services.loans.lendUnit(unit!.code, { description: 'thesis tests' }, env.admin);
    await expect(deletes.part(drill.code, env.admin)).rejects.toThrow(/Drill 1 of Drill is lent/);
    await expect(deletes.unit(unit!.code, env.admin)).rejects.toThrow(/lent out/);
    await units.update(unit!.code, { status: 'lost' }, env.admin);
    await deletes.unit(unit!.code, env.admin);
    await deletes.part(drill.code, env.admin);

    const bolt = await parts.create(
      {
        ...base,
        name: 'Bolt',
        stock: { location: shelf.code, amount: { mode: 'count', quantity: 5 } },
      },
      env.admin,
    );
    await builds.make({ name: 'Rig', lines: [{ part: bolt.code, quantity: 2 }] }, env.admin);
    await expect(deletes.part(bolt.code, env.admin)).rejects.toThrow(/built into/);

    const scope = await parts.create({ ...base, name: 'Scope', kind: 'tool' }, env.admin);
    const [one] = await units.add({ part: scope.code, units: [{ name: 'Scope 1' }] }, env.admin);
    const rig = await builds.make({ name: 'Bench rig', lines: [] }, env.admin);
    await units.move(one!.code, rig.build.code, env.admin);
    await expect(deletes.unit(one!.code, env.admin)).rejects.toThrow(/built into/);
    await expect(deletes.part(scope.code, env.admin)).rejects.toThrow(/built into/);
  });

  it('deletes empty places and builds only', async () => {
    const { locations, parts, units, builds, deletes } = env.services;
    const room = await locations.create({ name: 'Robolab', type: 'room' }, env.admin);
    const shelf = await locations.create(
      { name: 'Shelf 3', type: 'shelf', parent: room.code },
      env.admin,
    );
    await expect(deletes.location(room.code, env.admin)).rejects.toThrow(/isn't empty/);
    const drill = await parts.create({ ...base, name: 'Drill', kind: 'tool' }, env.admin);
    const [unit] = await units.add(
      { part: drill.code, units: [{ name: 'Drill 1' }], home: shelf.code },
      env.admin,
    );
    await units.move(unit!.code, room.code, env.admin);
    await expect(deletes.location(shelf.code, env.admin)).rejects.toThrow(/belong at/);
    await units.update(unit!.code, { home: room.code }, env.admin);
    await deletes.location(shelf.code, env.admin);
    expect((await locations.children(room.code)).map((c) => c.name)).toEqual([]);

    const rig = await builds.make({ name: 'Old rig', lines: [] }, env.admin);
    await deletes.location(rig.build.code, env.admin);
    await expect(locations.resolve(rig.build.code)).rejects.toThrow(/not found/);
    await expect(deletes.location((await locations.inbox()).code, env.admin)).rejects.toThrow(
      /can't be deleted/,
    );
  });
});
