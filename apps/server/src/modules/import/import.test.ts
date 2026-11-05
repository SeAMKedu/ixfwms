import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

describe('spreadsheet import', () => {
  it('previews, then creates drafts or adds stock to known parts, resolving places by name', async () => {
    const { locations, parts } = env.services;
    const lab = await locations.create({ name: 'Robotics lab', type: 'room' }, env.admin);
    const cab = await locations.create(
      { name: 'Cabinet A', type: 'cabinet', parent: lab.code },
      env.admin,
    );
    const shelf = await locations.create(
      { name: 'Shelf 3', type: 'shelf', parent: cab.code },
      env.admin,
    );
    const known = await parts.create(
      {
        name: 'VN-10',
        identifiers: [{ kind: 'order_no', value: 'VN-10-H-T3-PQ2-VQ3-RO1' }],
        tags: [],
        attributes: {},
        status: 'active',
      },
      env.admin,
    );
    const rows = [
      { name: 'Vacuum generator', orderNo: 'vn-10-h-t3-pq2-vq3-ro1', quantity: 2, tags: [] },
      {
        name: 'Bellows cup 30',
        manufacturer: 'Schmalz',
        quantity: 14,
        location: 'cabinet a › shelf 3',
        tags: ['Gripper v2'],
      },
      { name: 'PU tube 6/4', quantity: 7.5, unit: 'm' as const, location: shelf.code, tags: [] },
      { name: 'Ghost', quantity: 1, location: 'Cabinet Z', tags: [] },
      { name: 'VN-10 again', orderNo: 'VN-10-H-T3-PQ2-VQ3-RO1', tags: [] },
    ];
    const preview = await env.services.import.importParts(
      rows,
      { matchExisting: true, source: 'old-list.xlsx' },
      env.inventory,
      true,
    );
    expect(preview.map((r) => r.action)).toEqual([
      'add_stock',
      'create',
      'create',
      'error',
      'skip',
    ]);
    expect((await parts.search({ limit: 50, offset: 0 })).total).toBe(1);

    const done = await env.services.import.importParts(
      rows,
      { matchExisting: true, source: 'old-list.xlsx' },
      env.inventory,
      false,
    );
    expect(done.filter((r) => r.action === 'create').every((r) => r.part?.code)).toBe(true);
    expect((await parts.get(known.code)).lots[0]?.amount.quantity).toBe(2);
    const shelfDetail = await env.services.locationViews.detail(shelf.code);
    expect(shelfDetail.contents.map((c) => c.display).sort()).toEqual(['14 pcs', '7.5 m']);
    const cup = (await parts.search({ q: 'Bellows', limit: 1, offset: 0 })).items[0]!;
    expect(cup).toMatchObject({ status: 'draft', manufacturer: 'Schmalz', tags: ['Gripper v2'] });
  });

  it('saves and lists column mappings', async () => {
    const mapping = {
      columns: { name: 'Nimike', quantity: 'Määrä', orderNo: 'Tilausnumero' },
      headerRow: 1,
    };
    await env.services.import.saveMapping('Festo order export', mapping, env.inventory);
    await env.services.import.saveMapping(
      'Festo order export',
      { ...mapping, headerRow: 2 },
      env.inventory,
    );
    expect(await env.services.import.listMappings(env.admin)).toEqual([
      { name: 'Festo order export', mapping: { ...mapping, headerRow: 2 } },
    ]);
    await expect(
      env.services.import.importParts(
        [{ name: 'x', tags: [] }],
        { matchExisting: true },
        null,
        true,
      ),
    ).rejects.toThrow(/token/);
  });
});
