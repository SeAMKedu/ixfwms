import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

const draft = { identifiers: [], tags: [], attributes: {}, status: 'draft' as const };

describe('carrying things: scan, carry, scan', () => {
  it('picks up a box and part of a lot, then puts them down elsewhere', async () => {
    const { locations, carry, parts } = env.services;
    const shelf = await locations.create({ name: 'Shelf 3', type: 'shelf' }, env.admin);
    const box = await locations.create({ name: 'Box', type: 'box', parent: shelf.code }, env.admin);
    const cell = await locations.create({ name: 'Robot cell 2', type: 'zone' }, env.admin);
    const cup = await parts.create(
      {
        ...draft,
        name: 'Suction cup',
        stock: { location: shelf.code, amount: { mode: 'count', quantity: 10 } },
      },
      env.admin,
    );

    await carry.pick({ location: box.code }, env.admin);
    const state = await carry.pick({ lotId: cup.lots[0]!.id, quantity: 4 }, env.admin);
    expect(state.items.map((i) => i.kind).sort()).toEqual(['location', 'lot']);
    expect(state.location.kind).toBe('in_transit');

    // While carried, the box is still in the inventory, just "with admin".
    const boxPath = (await env.services.locationViews.detail(box.code)).path.map((p) => p.name);
    expect(boxPath).toEqual(['Carried by admin', 'Box']);

    const { moved, state: after } = await carry.drop(cell.code, null, env.admin);
    expect(moved).toBe(2);
    expect(after.items).toHaveLength(0);
    const cellDetail = await env.services.locationViews.detail(cell.code);
    expect(cellDetail.children.map((c) => c.name)).toEqual(['Box']);
    expect(cellDetail.contents.map((c) => c.display)).toEqual(['4 pcs']);
    expect((await parts.get(cup.code)).lots.map((l) => l.amount.quantity).sort()).toEqual([4, 6]);
  });

  it('keeps each person’s carry list separate and refuses silly drops', async () => {
    const { locations, carry } = env.services;
    const box = await locations.create({ name: 'Box', type: 'box' }, env.admin);
    await carry.pick({ location: box.code }, env.admin);
    expect((await carry.state(env.inventory)).items).toHaveLength(0);
    await expect(carry.drop(box.code, null, env.inventory)).rejects.toThrow(/Nothing/);
    await expect(carry.drop(box.code, null, env.admin)).rejects.toThrow(/into itself/);
    await expect(carry.pick({}, env.admin)).rejects.toThrow(/either/);
  });
});

describe('blank labels and codes', () => {
  it('reserves codes, then creates a place with one of them', async () => {
    const { labels, locations } = env.services;
    const blanks = await labels.blank(3, env.inventory, 'https://ixf.local');
    expect(blanks).toHaveLength(3);
    expect(blanks[0]!.qr).toBe(`HTTPS://IXF.LOCAL/L/${blanks[0]!.code}`);
    const code = blanks[0]!.code;
    expect(await labels.lookup(code)).toMatchObject({ assigned: null, reserved: true });

    const place = await locations.create(
      { name: 'Box: M3 screws', type: 'box', code: code.toLowerCase() },
      env.inventory,
    );
    expect(place.code).toBe(code);
    expect(await labels.lookup(code)).toMatchObject({ assigned: 'location', reserved: false });
    await expect(
      locations.create({ name: 'Again', type: 'box', code }, env.inventory),
    ).rejects.toThrow(/already used/);
    await expect(labels.blank(0, env.inventory, 'https://ixf.local')).rejects.toThrow(/1 to/);
  });

  it('builds labels for a place and everything inside it', async () => {
    const { labels, locations, parts } = env.services;
    const cab = await locations.create({ name: 'Cabinet A', type: 'cabinet' }, env.admin);
    const shelf = await locations.create(
      { name: 'Shelf 3', type: 'shelf', parent: cab.code },
      env.admin,
    );
    await parts.create(
      {
        ...draft,
        name: 'Cup',
        category: 'Pneumatics',
        stock: { location: shelf.code, amount: { mode: 'count', quantity: 1 } },
      },
      env.admin,
    );
    const all = await labels.forLocation(
      cab.code,
      { recursive: true, include: 'all' },
      'http://10.0.0.5:3000',
    );
    expect(all.map((l) => [l.kind, l.name, l.path])).toEqual([
      ['location', 'Cabinet A', ''],
      ['location', 'Shelf 3', 'Cabinet A'],
      ['part', 'Cup', 'Pneumatics'],
    ]);
    expect(all[1]!.qr).toBe(`HTTP://10.0.0.5:3000/L/${shelf.code}`);
  });
});
