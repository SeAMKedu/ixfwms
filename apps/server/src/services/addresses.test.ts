import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

describe('place addresses', () => {
  it('builds addresses from fixed places and keeps containers out of them', async () => {
    const { locations } = env.services;
    const lab = await locations.create(
      { name: 'Robotics lab', type: 'room', shortName: 'Robolab' },
      env.admin,
    );
    const cab = await locations.create(
      { name: 'Cabinet A', type: 'cabinet', parent: lab.code },
      env.admin,
    );
    const shelf = await locations.create(
      { name: 'Shelf C · fittings', type: 'shelf', parent: cab.code },
      env.admin,
    );
    const box = await locations.create(
      { name: 'Screws M4', type: 'box', parent: shelf.code, shortName: 'B7' },
      env.admin,
    );
    expect([cab.address, shelf.address, shelf.within]).toEqual([
      'Robolab-A',
      'Robolab-A-C',
      'Robolab-A',
    ]);
    expect(box).toMatchObject({ address: 'B7', within: 'Robolab-A-C', movable: true });
    expect((await locations.allWithPaths()).find((p) => p.code === shelf.code)?.address).toBe(
      'Robolab-A-C',
    );

    // A set short name must be free next to it; a guessed clash is only reported.
    await expect(
      locations.create(
        { name: 'Cabinet 2', type: 'cabinet', parent: lab.code, shortName: 'a' },
        env.admin,
      ),
    ).rejects.toThrow(/already has the short name A/);
    const other = await locations.create(
      { name: 'Cabinet A (old)', type: 'cabinet', parent: lab.code },
      env.admin,
    );
    const detail = await env.services.locationViews.detail(cab.code, { recursive: false });
    expect(detail.clashes.map((c) => c.code)).toEqual([other.code]);
    expect((await locations.update(other.code, { shortName: 'OLD' }, env.admin)).address).toBe(
      'Robolab-OLD',
    );
    // Moving a box doesn't change its address; moving a shelf does.
    await locations.move(box.code, cab.code, env.admin);
    expect((await locations.allWithPaths()).find((p) => p.code === box.code)).toMatchObject({
      address: 'B7',
      within: 'Robolab-A',
    });
  });

  it('steps set short names on when copying', async () => {
    const { locations } = env.services;
    const lab = await locations.create({ name: 'Lab', type: 'room' }, env.admin);
    const cab = await locations.create(
      { name: 'Left cabinet', type: 'cabinet', parent: lab.code, shortName: 'C1' },
      env.admin,
    );
    const copies = await locations.duplicate(cab.code, { count: 2 }, env.admin);
    expect(copies.map((c) => [c.name, c.short])).toEqual([
      ['Left cabinet 2', 'C2'],
      ['Left cabinet 3', 'C3'],
    ]);
  });
});

describe('place types', () => {
  it('lists, adds, changes and removes types; built-in ones are hidden', async () => {
    const { locations } = env.services;
    const types = await locations.types();
    expect(types.find((t) => t.key === 'pallet')).toMatchObject({ movable: true });
    expect(types.find((t) => t.key === 'shelf')).toMatchObject({ movable: false });
    expect(types.some((t) => t.key === 'system' || t.key === 'in_transit')).toBe(false);

    const cart = await locations.createType({ name: 'Tool cart', movable: true }, env.admin);
    expect(cart).toMatchObject({ key: 'tool_cart', movable: true, places: 0 });
    await locations.create({ name: 'Cart 1', type: 'tool_cart' }, env.admin);
    await expect(locations.deleteType('tool_cart', env.admin)).rejects.toThrow(/exist/);
    expect(
      await locations.updateType('tool_cart', { name: 'Trolley', movable: false }, env.admin),
    ).toMatchObject({ name: 'Trolley', movable: false, places: 1 });
    await locations.deleteType('pallet', env.admin);
    await expect(locations.deleteType('system', env.admin)).rejects.toThrow(/not found/);
    await expect(locations.createType({ name: 'X' }, env.inventory)).rejects.toThrow();

    // A removed default type stays removed after a restart.
    await locations.ensureDefaults();
    expect((await locations.types()).some((t) => t.key === 'pallet')).toBe(false);
  });
});
