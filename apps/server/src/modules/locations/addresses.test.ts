import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

describe('place addresses', () => {
  it('keeps addresses when a building goes above an address root', async () => {
    const { locations } = env.services;
    const lab = await locations.create(
      { name: 'Robotics lab', type: 'room', shortName: 'RL', addressRoot: true },
      env.admin,
    );
    const cabinet = await locations.create(
      { name: 'Cabinet 1', type: 'cabinet', parent: lab.code },
      env.admin,
    );
    const building = await locations.create(
      { name: 'Building 1', type: 'building', shortName: 'B1' },
      env.admin,
    );
    await locations.move(lab.code, building.code, env.admin);
    const addressNow = async () =>
      (await locations.pathOf(await locations.resolve(cabinet.code))).at(-1)!.address;
    expect(await addressNow()).toBe('RL-1');

    // Unmarked, the levels above come back.
    await locations.update(lab.code, { addressRoot: false }, env.admin);
    expect(await addressNow()).toBe('B1-RL-1');
  });

  it('keeps short names unique where addresses start', async () => {
    const { locations } = env.services;
    const b1 = await locations.create({ name: 'Building 1', type: 'building' }, env.admin);
    const b2 = await locations.create({ name: 'Building 2', type: 'building' }, env.admin);
    const root = { type: 'room', shortName: 'RL', addressRoot: true };
    const lab = await locations.create({ ...root, name: 'Lab', parent: b1.code }, env.admin);
    await expect(
      locations.create({ ...root, name: 'Other', parent: b2.code }, env.admin),
    ).rejects.toThrow(/already starts with RL/);
    // Top-level places start addresses as well.
    await expect(
      locations.create({ name: 'Annex', type: 'room', shortName: 'rl' }, env.admin),
    ).rejects.toThrow(/already starts with RL/);
    const other = await locations.create(
      { name: 'Other', type: 'room', shortName: 'RL', parent: b2.code },
      env.admin,
    );
    await expect(locations.update(other.code, { addressRoot: true }, env.admin)).rejects.toThrow(
      /already starts with RL/,
    );
    // Its own short name isn't a clash, and a guessed one counts too.
    await locations.update(lab.code, { shortName: 'RL', addressRoot: true }, env.admin);
    const guess = await locations.create(
      { name: 'Robotics lab', type: 'room', parent: b2.code },
      env.admin,
    );
    await expect(locations.update(guess.code, { addressRoot: true }, env.admin)).rejects.toThrow(
      /already starts with RL/,
    );
  });

  it('never starts an address at a movable place, and copies are not roots', async () => {
    const { locations } = env.services;
    await expect(
      locations.create({ name: 'Bin', type: 'box', addressRoot: true }, env.admin),
    ).rejects.toThrow(/movable/);
    const lab = await locations.create(
      { name: 'Lab', type: 'room', shortName: 'L1', addressRoot: true },
      env.admin,
    );
    await expect(locations.update(lab.code, { type: 'box' }, env.admin)).rejects.toThrow(/movable/);
    const [copy] = await locations.duplicate(lab.code, { count: 1 }, env.admin);
    expect(copy!.addressRoot).toBe(false);
  });

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
    const types = await env.services.placeTypes.types();
    expect(types.find((t) => t.key === 'pallet')).toMatchObject({ movable: true });
    expect(types.find((t) => t.key === 'shelf')).toMatchObject({ movable: false });
    expect(types.some((t) => t.key === 'system' || t.key === 'in_transit')).toBe(false);

    const cart = await env.services.placeTypes.createType(
      { name: 'Tool cart', movable: true },
      env.admin,
    );
    expect(cart).toMatchObject({ key: 'tool_cart', movable: true, places: 0 });
    await locations.create({ name: 'Cart 1', type: 'tool_cart' }, env.admin);
    await expect(env.services.placeTypes.deleteType('tool_cart', env.admin)).rejects.toThrow(
      /exist/,
    );
    expect(
      await env.services.placeTypes.updateType(
        'tool_cart',
        { name: 'Trolley', movable: false },
        env.admin,
      ),
    ).toMatchObject({ name: 'Trolley', movable: false, places: 1 });
    await env.services.placeTypes.deleteType('pallet', env.admin);
    await expect(env.services.placeTypes.deleteType('system', env.admin)).rejects.toThrow(
      /not found/,
    );
    await expect(
      env.services.placeTypes.createType({ name: 'X' }, env.inventory),
    ).rejects.toThrow();

    // A removed default type stays removed after a restart.
    await locations.ensureDefaults();
    expect((await env.services.placeTypes.types()).some((t) => t.key === 'pallet')).toBe(false);
  });
});
