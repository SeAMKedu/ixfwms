import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

const base = { identifiers: [], tags: [], attributes: {}, status: 'active' as const };

async function places() {
  const { locations } = env.services;
  const shelf = await locations.create({ name: 'Shelf 3', type: 'shelf' }, env.admin);
  const bench = await locations.create({ name: 'Workbench', type: 'workstation' }, env.admin);
  return { shelf, bench };
}

const lotsOf = async (code: string) =>
  (await env.services.parts.get(code)).lots
    .map((l) => [l.location.name, l.display, l.origin?.name ?? null])
    .sort(
      (a, b) =>
        String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])),
    );

/** The latest stock movement's id. */
const lastMove = async () =>
  (
    await env.database.client.execute(
      'SELECT id FROM stock_movements ORDER BY created_at DESC, id DESC',
    )
  ).rows[0]!.id as string;

describe('a known count out of an amount nobody counted', () => {
  it('takes 4 nuts from a box marked plenty, which stays plenty, and they go back into it', async () => {
    const { shelf, bench } = await places();
    const { parts, stock, open, history } = env.services;
    const nut = await parts.create(
      {
        ...base,
        name: 'Hex nut M3',
        stock: { location: shelf.code, amount: { mode: 'level', level: 'plenty' } },
      },
      env.admin,
    );
    await stock.move(nut.lots[0]!.id, bench.code, { pieces: 4 }, env.admin);
    expect(await lotsOf(nut.code)).toEqual([
      ['Shelf 3', 'plenty', null],
      ['Workbench', '4 pcs', 'Shelf 3'],
    ]);
    // Undo takes them back: into the box again.
    await history.undo('stock', await lastMove(), env.admin);
    expect(await lotsOf(nut.code)).toEqual([['Shelf 3', 'plenty', null]]);

    await stock.move(nut.lots[0]!.id, bench.code, { pieces: 4 }, env.admin);
    const cleared = await open.clear(bench.code, null, env.admin);
    expect(cleared.returned.map((r) => r.to.name)).toEqual(['Shelf 3']);
    expect(await lotsOf(nut.code)).toEqual([['Shelf 3', 'plenty', null]]);
    // Gone into the box: that can't be undone.
    await expect(history.undo('stock', await lastMove(), env.admin)).rejects.toThrow(
      /nobody has counted/,
    );
  });

  it('moves part of stock nobody counted, weighs out by piece mass, and refuses an empty box', async () => {
    const { shelf, bench } = await places();
    const { parts, stock } = env.services;
    const spacer = await parts.create(
      {
        ...base,
        name: 'Spacer',
        stock: { location: shelf.code, amount: { mode: 'count', uncounted: true } },
      },
      env.admin,
    );
    await stock.move(spacer.lots[0]!.id, bench.code, 3, env.admin);
    expect(await lotsOf(spacer.code)).toEqual([
      ['Shelf 3', '? pcs', null],
      ['Workbench', '3 pcs', 'Shelf 3'],
    ]);

    const washer = await parts.create(
      {
        ...base,
        name: 'Washer',
        unitMassG: 0.5,
        stock: { location: shelf.code, amount: { mode: 'measure', quantity: 50, unit: 'g' } },
      },
      env.admin,
    );
    await stock.move(washer.lots[0]!.id, bench.code, { pieces: 10 }, env.admin);
    expect(await lotsOf(washer.code)).toEqual([
      ['Shelf 3', '45 g', null],
      ['Workbench', '5 g', 'Shelf 3'],
    ]);

    const gone = await parts.create(
      {
        ...base,
        name: 'Rivet',
        stock: { location: shelf.code, amount: { mode: 'level', level: 'empty' } },
      },
      env.admin,
    );
    await expect(
      stock.move(gone.lots[0]!.id, bench.code, { pieces: 1 }, env.admin),
    ).rejects.toThrow(/marked empty/);
  });
});

describe('cut stock', () => {
  it('cuts 40 cm off a 6 m profile, and the offcut goes back as a piece of its own', async () => {
    const { shelf, bench } = await places();
    const { parts, stock, history } = env.services;
    const profile = await parts.create(
      {
        ...base,
        name: 'Profile 45x45',
        cut: 'length',
        stock: { location: shelf.code, amount: { mode: 'cut', pieces: [[6000], [1000]] } },
      },
      env.admin,
    );
    expect(profile.lots[0]!.display).toBe('2 pieces: 6 m, 1 m (7 m)');
    // From the smallest piece it fits in: the 1 m one.
    const cut = await stock.move(
      profile.lots[0]!.id,
      bench.code,
      { cut: { size: [400] } },
      env.admin,
    );
    expect(cut.display).toBe('1 piece: 400 mm');
    expect(await lotsOf(profile.code)).toEqual([
      ['Shelf 3', '2 pieces: 6 m, 600 mm (6.6 m)', null],
      ['Workbench', '1 piece: 400 mm', 'Shelf 3'],
    ]);
    await expect(history.undo('stock', await lastMove(), env.admin)).rejects.toThrow(/cut/);
    await stock.move(cut.id, shelf.code, null, env.admin);
    expect(await lotsOf(profile.code)).toEqual([
      ['Shelf 3', '3 pieces: 6 m, 600 mm, 400 mm (7 m)', null],
    ]);
    await expect(
      stock.move(profile.lots[0]!.id, bench.code, { cut: { size: [7000] } }, env.admin),
    ).rejects.toThrow(/big enough/);
  });

  it('cuts a sheet, keeping the strips either way, and only for cut stock', async () => {
    const { shelf, bench } = await places();
    const { parts, stock } = env.services;
    const sheet = await parts.create(
      {
        ...base,
        name: 'Aluminium sheet 1.5 mm',
        cut: 'sheet',
        stock: { location: shelf.code, amount: { mode: 'cut', pieces: [[1250, 2500]] } },
      },
      env.admin,
    );
    const lot = sheet.lots[0]!;
    await stock.move(
      lot.id,
      bench.code,
      { cut: { size: [300, 200], leftover: 'across' } },
      env.admin,
    );
    expect((await lotsOf(sheet.code))[0]).toEqual([
      'Shelf 3',
      '2 sheets: 950 × 2500, 300 × 2300 (3.07 m²)',
      null,
    ]);
    const again = (await parts.get(sheet.code)).lots.find((l) => l.location.code === shelf.code)!;
    await stock.move(
      again.id,
      bench.code,
      { cut: { size: [200, 2400], leftover: 'scrap' } },
      env.admin,
    );
    expect((await lotsOf(sheet.code))[0]![1]).toBe('1 sheet: 300 × 2300');

    const bolt = await parts.create({ ...base, name: 'Bolt' }, env.admin);
    await expect(
      stock.add(
        { part: bolt.code, location: shelf.code, amount: { mode: 'cut', pieces: [[10]] } },
        env.admin,
      ),
    ).rejects.toThrow(/isn't cut stock/);
  });

  it('cuts from a total length or area, and from bars nobody measured', async () => {
    const { shelf, bench } = await places();
    const { parts, stock } = env.services;
    const tube = await parts.create(
      {
        ...base,
        name: 'Tube 20 mm',
        cut: 'length',
        stock: { location: shelf.code, amount: { mode: 'measure', quantity: 6, unit: 'm' } },
      },
      env.admin,
    );
    await stock.move(tube.lots[0]!.id, bench.code, { cut: { size: [400] } }, env.admin);
    expect(await lotsOf(tube.code)).toEqual([
      ['Shelf 3', '5.6 m', null],
      ['Workbench', '1 piece: 400 mm', 'Shelf 3'],
    ]);
    const mdf = await parts.create(
      {
        ...base,
        name: 'MDF 6 mm',
        cut: 'sheet',
        stock: { location: shelf.code, amount: { mode: 'measure', quantity: 2, unit: 'm2' } },
      },
      env.admin,
    );
    await stock.move(mdf.lots[0]!.id, bench.code, { cut: { size: [500, 1000] } }, env.admin);
    expect((await lotsOf(mdf.code))[0]![1]).toBe('1.5 m²');
    const rod = await parts.create(
      {
        ...base,
        name: 'Rod 8 mm',
        cut: 'length',
        stock: { location: shelf.code, amount: { mode: 'count', quantity: 3 } },
      },
      env.admin,
    );
    await stock.move(rod.lots[0]!.id, bench.code, { cut: { size: [250] } }, env.admin);
    expect(await lotsOf(rod.code)).toEqual([
      ['Shelf 3', '3 pcs', null],
      ['Workbench', '1 piece: 250 mm', 'Shelf 3'],
    ]);
  });

  it('cuts pieces into a build, and the check counts what could be cut', async () => {
    const { shelf } = await places();
    const { parts, builds, bom } = env.services;
    const profile = await parts.create(
      {
        ...base,
        name: 'Profile 45x45',
        cut: 'length',
        stock: { location: shelf.code, amount: { mode: 'cut', pieces: [[6000]] } },
      },
      env.admin,
    );
    const { build } = await builds.make({ name: 'Gripper v3', lines: [] }, env.admin);
    const r = await builds.addParts(
      build.code,
      { part: profile.code, quantity: 2, size: [400] },
      env.admin,
    );
    expect(r.moved.map((m) => m.display)).toEqual(['400 mm', '400 mm']);
    expect((await parts.get(profile.code)).lots.map((l) => l.display).sort()).toEqual([
      '1 piece: 5.2 m',
      '2 pieces: 400 mm, 400 mm (0.8 m)',
    ]);
    const check = await bom.check([{ ref: profile.code, quantity: 3, size: '400' }]);
    expect(check.lines[0]).toMatchObject({
      available: 13,
      salvageable: 2,
      status: 'ok',
      size: [400],
    });
  });
});
