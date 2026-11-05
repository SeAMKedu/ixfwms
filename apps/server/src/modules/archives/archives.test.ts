import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

const active = { status: 'active' as const };
const names = async (input: { q?: string; status?: 'archived' }) =>
  (await env.services.parts.search({ ...input, offset: 0, limit: 50 })).items.map((p) => p.name);

describe('archiving', () => {
  it('leaves archived items out of search until asked for, and brings them back', async () => {
    const { parts } = env.services;
    await parts.create({ ...active, name: 'Gripper v2 finger' }, env.admin);
    const old = await parts.create({ ...active, name: 'Gripper v1 finger' }, env.admin);
    await parts.setStatus(old.code, 'archived', env.admin);

    expect(await names({ q: 'gripper' })).toEqual(['Gripper v2 finger']);
    expect(await names({ status: 'archived' })).toEqual(['Gripper v1 finger']);
    // Its own code still finds it.
    expect(await names({ q: old.code })).toEqual(['Gripper v1 finger']);

    await parts.setStatus(old.code, 'active', env.admin);
    expect(await names({ q: 'gripper' })).toEqual(['Gripper v1 finger', 'Gripper v2 finger']);
  });

  it('archives an empty container out of sight; nothing goes in until it is back', async () => {
    const { archives, locations, locationViews, parts, stock } = env.services;
    const shelf = await locations.create({ name: 'Shelf 3', type: 'shelf' }, env.admin);
    const box = await locations.create(
      { name: 'Old box', type: 'box', parent: shelf.code },
      env.admin,
    );
    const screws = await parts.create(
      {
        ...active,
        name: 'M3 screw',
        stock: { location: box.code, amount: { mode: 'count', quantity: 5 } },
      },
      env.admin,
    );

    await expect(archives.place(shelf.code, env.admin)).rejects.toThrow(/only movable/);
    await expect(archives.place(box.code, env.admin)).rejects.toThrow(/isn't empty/);
    await stock.move(screws.lots[0]!.id, shelf.code, 5, env.admin);
    expect((await archives.place(box.code, env.admin)).archivedAt).not.toBeNull();

    expect(await locations.children(shelf.code)).toEqual([]);
    expect((await locations.allWithPaths()).map((p) => p.name)).not.toContain('Old box');
    expect((await locationViews.detail(shelf.code)).archived.map((p) => p.name)).toEqual([
      'Old box',
    ]);
    const lot = (await parts.get(screws.code)).lots[0]!;
    await expect(stock.move(lot.id, box.code, 1, env.admin)).rejects.toThrow(/is archived/);

    await archives.unarchivePlace(box.code, env.admin);
    await stock.move(lot.id, box.code, 1, env.admin);
    expect((await locations.children(shelf.code)).map((p) => p.name)).toEqual(['Old box']);
    await expect(archives.unarchivePlace(box.code, env.admin)).rejects.toThrow(/isn't archived/);
  });
});
