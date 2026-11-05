import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

const base = { identifiers: [], tags: [], attributes: {}, status: 'active' as const };

/** A cell to build in, a shelf of screws (counted and weighed), a bench, and two servos. */
async function lab() {
  const { locations, parts, units } = env.services;
  const cell = await locations.create({ name: 'Robot cell 2', type: 'zone' }, env.admin);
  const shelf = await locations.create({ name: 'Shelf 3', type: 'shelf' }, env.admin);
  const drawer = await locations.create({ name: 'Drawer 1', type: 'drawer' }, env.admin);
  const bench = await locations.create({ name: 'Workbench', type: 'workstation' }, env.admin);
  const screw = await parts.create(
    {
      ...base,
      name: 'Socket head screw M3x10',
      minStock: 10,
      stock: { location: shelf.code, amount: { mode: 'count', quantity: 20 } },
    },
    env.admin,
  );
  const nut = await parts.create(
    {
      ...base,
      name: 'Hex nut M3',
      unitMassG: 0.5,
      stock: { location: drawer.code, amount: { mode: 'measure', quantity: 50, unit: 'g' } },
    },
    env.admin,
  );
  const fitting = await parts.create(
    {
      ...base,
      name: 'Push-in fitting 6 mm',
      stock: { location: shelf.code, amount: { mode: 'level', level: 'plenty' } },
    },
    env.admin,
  );
  const servo = await parts.create({ ...base, name: 'Servo MG996R', kind: 'device' }, env.admin);
  await units.add(
    { part: servo.code, units: [{ name: 'Servo A' }, { name: 'Servo B' }], home: shelf.code },
    env.admin,
  );
  return { cell, shelf, drawer, bench, screw, nut, fitting, servo };
}

const lotsOf = async (code: string) =>
  (await env.services.parts.get(code)).lots
    .map((l) => [l.location.name, l.amount.quantity, l.origin?.name ?? null])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

describe('builds', () => {
  it('makes a build from a parts list, moving in what it can and listing the rest', async () => {
    const { cell, screw, nut, fitting, servo } = await lab();
    const made = await env.services.builds.make(
      {
        name: 'Gripper v3',
        parent: cell.code,
        contact: 'Mika',
        lines: [
          { part: screw.code, quantity: 8 },
          { part: nut.code, quantity: 8 },
          { part: fitting.code, quantity: 2 },
          { part: servo.code, quantity: 3 },
          { part: 'NOPE99', quantity: 1 },
        ],
      },
      env.admin,
    );
    expect(made.build).toMatchObject({
      name: 'Gripper v3',
      build: true,
      inBuild: { name: 'Gripper v3' },
    });
    expect(made.moved.map((m) => [m.name, m.display])).toEqual([
      ['Socket head screw M3x10', '8 pcs'],
      ['Hex nut M3', '8 pcs'],
      ['Push-in fitting 6 mm', '2 pcs'],
      ['Servo A', '1 pcs'],
      ['Servo B', '1 pcs'],
    ]);
    // The fittings came out of a box marked plenty, which stays plenty.
    expect(await lotsOf(fitting.code)).toEqual([
      ['Gripper v3', 2, 'Shelf 3'],
      ['Shelf 3', null, null],
    ]);
    expect(made.left).toEqual([
      { name: 'Servo MG996R', quantity: 1, reason: 'short' },
      { name: 'NOPE99', quantity: 1, reason: 'unknown' },
    ]);
    // In the build, each lot remembers where it came from.
    expect(await lotsOf(screw.code)).toEqual([
      ['Gripper v3', 8, 'Shelf 3'],
      ['Shelf 3', 12, null],
    ]);
    expect(await lotsOf(nut.code)).toEqual([
      ['Drawer 1', 46, null],
      ['Gripper v3', 4, 'Drawer 1'],
    ]);
  });

  it("doesn't count built-in parts as free stock, but says they could be salvaged", async () => {
    const { cell, screw, servo } = await lab();
    const { builds, bom, parts } = env.services;
    await builds.make(
      {
        name: 'Gripper v3',
        parent: cell.code,
        lines: [
          { part: screw.code, quantity: 15 },
          { part: servo.code, quantity: 2 },
        ],
      },
      env.admin,
    );
    const check = await bom.check([
      { ref: screw.code, quantity: 10 },
      { ref: servo.code, quantity: 1 },
    ]);
    expect(check.lines.map((l) => [l.available, l.salvageable, l.status])).toEqual([
      [5, 15, 'short'],
      [0, 2, 'missing'],
    ]);
    expect(check.lines[0]!.where.map((w) => w.build?.name ?? null)).toEqual([null, 'Gripper v3']);

    // 5 free is below the minimum of 10; the servos are all built in.
    const low = await parts.search({ lowStock: true, limit: 50, offset: 0 });
    expect(low.items.map((p) => p.name)).toEqual(['Socket head screw M3x10']);
    const inStock = await parts.search({ inStock: true, limit: 50, offset: 0 });
    expect(inStock.items.map((p) => p.name)).not.toContain('Servo MG996R');
  });

  it('dismantles back where everything came from, then keeps the record', async () => {
    const { cell, shelf, screw, servo } = await lab();
    const { builds, locations, locationViews, stock } = env.services;
    const { build } = await builds.make(
      {
        name: 'Gripper v3',
        parent: cell.code,
        lines: [
          { part: screw.code, quantity: 8 },
          { part: servo.code, quantity: 1 },
        ],
      },
      env.admin,
    );
    // A spare screw from someone's pocket has no origin, so it stays until put away by hand.
    const pocket = await stock.add(
      { part: screw.code, location: build.code, amount: { mode: 'count', quantity: 1 } },
      env.admin,
    );
    expect(pocket.id).not.toBe('');
    const first = await builds.dismantle(build.code, {}, env.admin);
    expect(first.dismantled).toBe(false);
    expect(first.returned.map((r) => [r.name, r.to.name])).toEqual([
      ['Servo A', 'Shelf 3'],
      ['Socket head screw M3x10', 'Shelf 3'],
    ]);
    expect(first.left).toEqual([{ kind: 'lot', name: 'Socket head screw M3x10' }]);

    const left = (await env.services.parts.get(screw.code)).lots.find(
      (l) => l.location.code === build.code,
    )!;
    await stock.move(left.id, shelf.code, null, env.admin);
    const second = await builds.dismantle(build.code, {}, env.admin);
    expect(second.dismantled).toBe(true);
    expect(await lotsOf(screw.code)).toEqual([['Shelf 3', 21, null]]);

    const page = await locationViews.detail(build.code);
    expect(page.dismantledAt).not.toBeNull();
    expect(page.overdue).toBe(false);
    expect(page.wasInIt.map((w) => [w.kind, w.name])).toEqual([
      ['part', 'Socket head screw M3x10'],
      ['unit', 'Servo A'],
    ]);
    // Nothing goes into a dismantled build.
    await expect(
      stock.add(
        { part: screw.code, location: build.code, amount: { mode: 'count', quantity: 1 } },
        env.admin,
      ),
    ).rejects.toThrow(/dismantled/);
    await expect(
      locations.create({ name: 'Box', type: 'box', parent: build.code }, env.admin),
    ).rejects.toThrow(/dismantled/);
    await expect(builds.dismantle(build.code, {}, env.admin)).rejects.toThrow(/already/);
  });

  it('dismantles onto a workstation, and clearing the bench sends things home', async () => {
    const { cell, bench, screw, servo } = await lab();
    const { builds, locations, open } = env.services;
    const { build } = await builds.make(
      {
        name: 'Gripper v3',
        parent: cell.code,
        lines: [
          { part: screw.code, quantity: 8 },
          { part: servo.code, quantity: 1 },
        ],
      },
      env.admin,
    );
    await locations.create({ name: 'Cable bag', type: 'bin', parent: build.code }, env.admin);
    await expect(builds.dismantle(build.code, { to: build.code }, env.admin)).rejects.toThrow(
      /outside/,
    );

    const done = await builds.dismantle(build.code, { to: bench.code }, env.admin);
    expect(done.dismantled).toBe(true);
    expect(await lotsOf(screw.code)).toEqual([
      ['Shelf 3', 12, null],
      ['Workbench', 8, 'Shelf 3'],
    ]);
    const cleared = await open.clear(bench.code, null, env.admin);
    expect(cleared.returned.map((r) => r.name).sort()).toEqual([
      'Servo A',
      'Socket head screw M3x10',
    ]);
    expect(cleared.left).toEqual([{ kind: 'place', name: 'Cable bag' }]);
  });

  it('shows builds in search: by text, dismantled ones marked, and with the Builds filter', async () => {
    const { cell, screw } = await lab();
    const { builds, parts } = env.services;
    const { build } = await builds.make(
      {
        name: 'Gripper v3',
        parent: cell.code,
        description: 'Vacuum gripper for the UR5',
        lines: [{ part: screw.code, quantity: 4 }],
      },
      env.admin,
    );
    const rig = await builds.make({ name: 'Old test rig', lines: [] }, env.admin);
    await builds.dismantle(rig.build.code, {}, env.admin);
    expect((await builds.list(true)).map((b) => b.name)).toEqual(['Old test rig']);
    expect((await builds.list(false)).map((b) => b.name)).toEqual(['Gripper v3']);

    // Without text, standing builds are listed among the items by name.
    const all = await parts.search({ limit: 50, offset: 0 });
    const names = all.rows.map((row) =>
      'buildId' in row
        ? all.builds.find((b) => b.id === row.buildId)!.name
        : all.items.find((p) => p.id === row.partId)!.name,
    );
    expect(names.indexOf('Gripper v3')).toBe(names.indexOf('Hex nut M3') - 1);
    expect(names).not.toContain('Old test rig');
    expect(all.total).toBe(names.length);
    // Lists of items (one row per part) leave builds out.
    expect((await parts.search({ byUnit: false, limit: 50, offset: 0 })).builds).toEqual([]);

    const byText = await parts.search({ q: 'vacuum', limit: 50, offset: 0 });
    expect(byText.builds.map((b) => [b.name, b.in?.name, b.items])).toEqual([
      ['Gripper v3', 'Robot cell 2', 1],
    ]);
    const byCode = await parts.search({ q: build.code, limit: 50, offset: 0 });
    expect(byCode.builds.map((b) => b.name)).toEqual(['Gripper v3']);

    const only = await parts.search({ kind: 'build', limit: 50, offset: 0 });
    expect(only.items).toEqual([]);
    expect(only.builds.map((b) => b.name)).toEqual(['Gripper v3']);
    const old = await parts.search({ q: 'rig', limit: 50, offset: 0 });
    expect(old.builds.map((b) => [b.name, !!b.dismantledAt])).toEqual([['Old test rig', true]]);

    // A screw's stock says it's built in.
    const screwRow = await parts.search({ q: 'M3x10', limit: 50, offset: 0 });
    expect(screwRow.items[0]!.stock.map((s) => s.place.inBuild?.name ?? null)).toContain(
      'Gripper v3',
    );
    // Item filters leave builds out.
    expect(
      (await parts.search({ q: 'gripper', inStock: true, limit: 50, offset: 0 })).builds,
    ).toEqual([]);
  });

  it('puts an item into a build from the stock chosen, and adds the rest as new', async () => {
    const { cell, shelf, screw, servo } = await lab();
    const { builds, stock } = env.services;
    const drawer = await env.services.locations.create(
      { name: 'Drawer 9', type: 'drawer' },
      env.admin,
    );
    const moved = await stock.add(
      { part: screw.code, location: drawer.code, amount: { mode: 'count', quantity: 5 } },
      env.admin,
    );
    const { build } = await builds.make(
      { name: 'Gripper v3', parent: cell.code, lines: [] },
      env.admin,
    );

    // From the drawer's 5, and 3 more bought new.
    const r = await builds.addParts(
      build.code,
      { part: screw.code, quantity: 8, from: moved.id, restAsNew: true },
      env.admin,
    );
    expect(r.moved.map((m) => [m.display, m.from.name])).toEqual([['5 pcs', 'Drawer 9']]);
    expect(r.added).toBe('3 pcs');
    expect(r.left).toEqual([]);
    expect(await lotsOf(screw.code)).toEqual(
      expect.arrayContaining([
        ['Gripper v3', 3, null],
        ['Gripper v3', 5, 'Drawer 9'],
        ['Shelf 3', 20, null],
      ]),
    );

    // Fullest free stock by default; units one by one, the rest only listed.
    const s = await builds.addParts(build.code, { part: servo.code, quantity: 3 }, env.admin);
    expect(s.moved.map((m) => m.name)).toEqual(['Servo A', 'Servo B']);
    expect(s.left).toEqual([{ name: 'Servo MG996R', quantity: 1, reason: 'short' }]);
    await expect(
      builds.addParts(shelf.code, { part: screw.code, quantity: 1 }, env.admin),
    ).rejects.toThrow(/isn't a build/);
  });

  it('refuses to make a build of a type that is not a build type', async () => {
    await expect(
      env.services.builds.make({ name: 'Just a box', type: 'box', lines: [] }, env.admin),
    ).rejects.toThrow(/isn't a build/);
  });
});
