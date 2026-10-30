import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

async function lab() {
  const { locations } = env.services;
  const room = await locations.create({ name: 'Robotics lab', type: 'room' }, env.admin);
  const cabinet = await locations.create(
    { name: 'Cabinet A', type: 'cabinet', parent: room.code },
    env.admin,
  );
  const shelf = await locations.create(
    { name: 'Shelf 3', type: 'shelf', parent: cabinet.code },
    env.admin,
  );
  const box = await locations.create(
    { name: 'Box: vacuum parts', type: 'box', parent: shelf.code },
    env.admin,
  );
  return { room, cabinet, shelf, box };
}

describe('locations', () => {
  it('builds paths and resolves by code case-insensitively', async () => {
    const { box } = await lab();
    const detail = await env.services.locationViews.detail(box.code.toLowerCase());
    expect(detail.path.map((p) => p.name)).toEqual([
      'Robotics lab',
      'Cabinet A',
      'Shelf 3',
      'Box: vacuum parts',
    ]);
  });

  it('moves a box with its contents and keeps paths consistent', async () => {
    const { room, box, shelf } = await lab();
    const other = await env.services.locations.create(
      { name: 'Robot cell 2', type: 'zone', parent: room.code },
      env.admin,
    );
    const inner = await env.services.locations.create(
      { name: 'Bag', type: 'bin', parent: box.code },
      env.admin,
    );
    await env.services.locations.move(box.code, other.code, env.admin);
    const path = (await env.services.locationViews.detail(inner.code)).path.map((p) => p.name);
    expect(path).toEqual(['Robotics lab', 'Robot cell 2', 'Box: vacuum parts', 'Bag']);
    expect((await env.services.locationViews.detail(shelf.code)).children).toHaveLength(0);
  });

  it('refuses to move a place into itself', async () => {
    const { cabinet, box } = await lab();
    await expect(env.services.locations.move(cabinet.code, box.code, env.admin)).rejects.toThrow(
      /into itself/,
    );
  });

  it('protects the Inbox and needs a token to write', async () => {
    const inbox = await env.services.locations.inbox();
    await expect(env.services.locations.move(inbox.code, null, env.admin)).rejects.toThrow(
      /can't be moved/,
    );
    await expect(env.services.locations.create({ name: 'x', type: 'box' }, null)).rejects.toThrow(
      /token/,
    );
  });

  it('gives each user one carry location', async () => {
    const a = await env.services.locations.inTransitFor(env.admin);
    const b = await env.services.locations.inTransitFor(env.admin);
    expect(a.id).toBe(b.id);
    expect(a.name).toBe('Carried by admin');
  });

  it('returns a tree', async () => {
    const { room } = await lab();
    const [top] = await env.services.locations.tree(room.code, 2);
    expect(top?.name).toBe('Robotics lab');
    expect(top?.children[0]?.children[0]?.name).toBe('Shelf 3');
    expect(top?.children[0]?.children[0]?.children).toHaveLength(0);
  });
});

describe('parts and stock', () => {
  it('creates a draft with identifiers, tags, category and stock in the Inbox', async () => {
    const part = await env.services.parts.create(
      {
        name: 'Vacuum generator VN-10',
        manufacturer: 'Festo',
        category: 'Pneumatics / Vacuum',
        identifiers: [{ kind: 'order_no', value: 'VN-10-H-T3-PQ2-VQ3-RO1' }],
        tags: ['Gripper v2'],
        attributes: {},
        status: 'draft',
        stock: { amount: { mode: 'count', quantity: 4 } },
      },
      env.inventory,
    );
    expect(part.status).toBe('draft');
    expect(part.category).toBe('Pneumatics/Vacuum');
    expect(part.lots[0]?.location.kind).toBe('inbox');
    const found = await env.services.parts.search({ q: 'vn10ht3', limit: 10, offset: 0 });
    expect(found.items.map((p) => p.code)).toEqual([part.code]);
    expect(
      (await env.services.parts.search({ category: 'pneumatics', limit: 10, offset: 0 })).total,
    ).toBe(1);
    expect(
      (await env.services.parts.search({ tags: ['gripper v2'], limit: 10, offset: 0 })).total,
    ).toBe(1);
  });

  it('only lets the write scope create active parts or confirm drafts', async () => {
    const input = {
      name: 'x',
      identifiers: [],
      tags: [],
      attributes: {},
      status: 'active' as const,
    };
    await expect(env.services.parts.create(input, env.inventory)).rejects.toThrow(/write/);
    const draft = await env.services.parts.create({ ...input, status: 'draft' }, env.inventory);
    await expect(env.services.parts.setStatus(draft.code, 'active', env.inventory)).rejects.toThrow(
      /write/,
    );
    expect((await env.services.parts.setStatus(draft.code, 'active', env.admin)).status).toBe(
      'active',
    );
  });

  it('finds duplicates by order number and by name', async () => {
    const base = { identifiers: [], tags: [], attributes: {}, status: 'draft' as const };
    await env.services.parts.create(
      {
        ...base,
        name: 'CPU 1214C DC/DC/DC',
        identifiers: [{ kind: 'order_no', value: '6ES7 214-1AG40-0XB0' }],
      },
      env.admin,
    );
    await env.services.parts.create({ ...base, name: 'Bellows suction cup 30 NBR' }, env.admin);
    const byId = await env.services.parts.findSimilar(null, ['6ES72141AG400XB0']);
    expect(byId[0]?.score).toBe(1);
    const byName = await env.services.parts.findSimilar('suction cup bellows 30', []);
    expect(byName[0]?.name).toBe('Bellows suction cup 30 NBR');
    expect(await env.services.parts.findSimilar('terminal block', [])).toHaveLength(0);
  });

  it('merges, takes, and splits stock when moving part of a lot', async () => {
    const { box, shelf } = await lab();
    const part = await env.services.parts.create(
      { name: 'Suction cup', identifiers: [], tags: [], attributes: {}, status: 'draft' },
      env.admin,
    );
    const lot = await env.services.stock.add(
      { part: part.code, location: box.code, amount: { mode: 'count', quantity: 10 } },
      env.admin,
    );
    const merged = await env.services.stock.add(
      { part: part.code, location: box.code, amount: { mode: 'count', quantity: 4 } },
      env.admin,
    );
    expect(merged.id).toBe(lot.id);
    expect(merged.amount.quantity).toBe(14);

    const taken = await env.services.stock.take(lot.id, 2, null, env.admin);
    expect(taken.amount.quantity).toBe(12);
    await expect(env.services.stock.take(lot.id, 50, null, env.admin)).rejects.toThrow(
      /Only 12 pcs/,
    );

    const moved = await env.services.stock.move(lot.id, shelf.code, 5, env.admin);
    expect(moved.location.code).toBe(shelf.code);
    expect(moved.amount.quantity).toBe(5);
    const detail = await env.services.parts.get(part.code);
    expect(detail.lots.map((l) => l.amount.quantity).sort()).toEqual([5, 7]);

    const back = await env.services.stock.move(moved.id, box.code, null, env.admin);
    expect(back.amount.quantity).toBe(12);
    expect((await env.services.parts.get(part.code)).lots).toHaveLength(1);
    expect((await env.services.parts.get(part.code)).history.map((h) => h.reason)).toContain(
      'move',
    );
  });

  it('estimates counts for weighed stock and keeps levels separate', async () => {
    const { box } = await lab();
    const part = await env.services.parts.create(
      {
        name: 'Screw M4x12',
        unitMassG: 1.2,
        identifiers: [],
        tags: [],
        attributes: {},
        status: 'draft',
      },
      env.admin,
    );
    const weighed = await env.services.stock.add(
      {
        part: part.code,
        location: box.code,
        amount: { mode: 'measure', quantity: 342, unit: 'g', tareG: 30 },
      },
      env.admin,
    );
    expect(weighed.estimatedCount).toBe(260);
    const level = await env.services.stock.add(
      { part: part.code, location: box.code, amount: { mode: 'level', level: 'plenty' } },
      env.admin,
    );
    expect(level.id).not.toBe(weighed.id);
    const low = await env.services.stock.take(level.id, null, 'low', env.admin);
    expect(low.amount.level).toBe('low');
    expect((await env.services.parts.search({ inStock: true, limit: 10, offset: 0 })).total).toBe(
      1,
    );
  });
});

describe('backups', () => {
  it('snapshots the database and keeps only the newest ones', async () => {
    await env.services.backup.backup('one');
    await env.services.backup.backup('two');
    await env.services.backup.backup('three');
    const list = await env.services.backup.list();
    expect(list).toHaveLength(2);
    expect(list.every((b) => b.size > 0)).toBe(true);
  });
});
