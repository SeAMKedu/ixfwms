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
    await expect(carry.pick({}, env.admin)).rejects.toThrow(/a place, a stock lot or a unit/);
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

describe('managing labels', () => {
  it('lists batches, re-downloads unused codes, retires lost ones', async () => {
    const { labels, locations } = env.services;
    const first = await labels.blank(3, env.inventory, 'https://ixf.local');
    await locations.create({ name: 'Box', type: 'box', code: first[0]!.code }, env.inventory);
    await labels.retire([first[1]!.code], env.inventory);

    const [batch] = await labels.batches();
    expect(batch).toMatchObject({
      unused: [first[2]!.code],
      used: 1,
      retired: 1,
      createdBy: 'assistant',
    });
    expect((await labels.batchLabels(batch!.id, 'https://ixf.local')).map((l) => l.code)).toEqual([
      first[2]!.code,
    ]);

    expect(await labels.lookup(first[1]!.code)).toMatchObject({
      reserved: false,
      retired: { note: 'retired by hand' },
    });
    await expect(
      locations.create({ name: 'Other', type: 'box', code: first[1]!.code }, env.inventory),
    ).rejects.toThrow(/retired/);
    await expect(labels.retire([first[0]!.code], env.inventory)).rejects.toThrow(
      /change that location/,
    );
  });

  it('changes a code to the sticker actually on the box, retiring the old one', async () => {
    const { labels, locations, parts } = env.services;
    const box = await locations.create({ name: 'Box: M3 screws', type: 'box' }, env.inventory);
    const [sticker] = await labels.blank(1, env.inventory, 'https://ixf.local');
    const code = await labels.changeCode(
      'location',
      box.code,
      sticker!.code.toLowerCase(),
      env.inventory,
    );
    expect(code).toBe(sticker!.code);
    expect(await labels.lookup(box.code)).toMatchObject({
      assigned: null,
      retired: { note: 'was place Box: M3 screws' },
    });
    expect((await locations.resolve(code)).name).toBe('Box: M3 screws');

    const part = await parts.create(
      { name: 'Cup', identifiers: [], tags: [], attributes: {}, status: 'draft' },
      env.inventory,
    );
    const fresh = await labels.changeCode('part', part.code, null, env.inventory);
    expect(fresh).not.toBe(part.code);
    expect((await parts.get(fresh)).name).toBe('Cup');
    // A retired code is never handed out again, and its labels aren't "blank labels".
    expect((await labels.batches()).every((b) => !b.unused.includes(part.code))).toBe(true);
  });

  it('swaps the codes of two places whose stickers got switched', async () => {
    const { labels, locations } = env.services;
    const a = await locations.create({ name: 'Box A', type: 'box' }, env.inventory);
    const b = await locations.create({ name: 'Box B', type: 'box' }, env.inventory);
    await labels.swapCodes(a.code, b.code, env.inventory);
    expect((await locations.resolve(a.code)).name).toBe('Box B');
    expect((await locations.resolve(b.code)).name).toBe('Box A');
    await expect(labels.swapCodes(a.code, a.code, env.inventory)).rejects.toThrow(/two different/);
  });
});
