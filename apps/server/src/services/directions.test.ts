import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => {
  await env.cleanup();
});

describe('place hints', () => {
  it('forgets where a moved container was, but not where a fixed place is', async () => {
    const { locations, locationViews } = env.services;
    const lab = await locations.create({ name: 'Lab', type: 'room' }, env.admin);
    const shelf = await locations.create(
      { name: 'Shelf 1', type: 'shelf', parent: lab.code, hint: 'By the door' },
      env.admin,
    );
    const other = await locations.create(
      { name: 'Shelf 2', type: 'shelf', parent: lab.code },
      env.admin,
    );
    const box = await locations.create(
      { name: 'Fittings', type: 'box', parent: shelf.code, hint: 'Behind the blue bin' },
      env.admin,
    );

    await locations.move(box.code, other.code, env.admin);
    await locations.move(shelf.code, null, env.admin);
    expect((await locationViews.detail(box.code, {})).hint).toBeNull();
    expect((await locationViews.detail(shelf.code, {})).hint).toBe('By the door');
  });

  it("copies keep the numbering and the hints inside, not the copied place's own", async () => {
    const { locations, locationViews } = env.services;
    const lab = await locations.create({ name: 'Lab', type: 'room' }, env.admin);
    const cabinet = await locations.create(
      {
        name: 'Cabinet A',
        type: 'cabinet',
        parent: lab.code,
        hint: 'By the window',
        numberFrom: 'top',
      },
      env.admin,
    );
    await locations.create(
      { name: 'Shelf 1', type: 'shelf', parent: cabinet.code, hint: 'Behind the glass door' },
      env.admin,
    );

    const [copy] = await locations.duplicate(cabinet.code, {}, env.admin);
    const detail = await locationViews.detail(copy!.code, {});
    expect(detail).toMatchObject({ name: 'Cabinet B', hint: null, numberFrom: 'top' });
    expect((await locationViews.detail(detail.children[0]!.code, {})).hint).toBe(
      'Behind the glass door',
    );
  });

  it('counts drawers by short name, so they can be named after what is in them', async () => {
    const { locations } = env.services;
    const cabinet = await locations.create(
      { name: 'Drawer cabinet', type: 'cabinet', numberFrom: 'left' },
      env.admin,
    );
    const drawers: Record<string, string> = {};
    for (const [short, name] of [
      ['1', 'Zip ties'],
      ['2', 'Allen keys'],
      ['3', 'M3×10 DIN 912'],
    ] as const)
      drawers[short] = (
        await locations.create(
          { name, shortName: short, type: 'drawer', parent: cabinet.code },
          env.admin,
        )
      ).code;

    expect((await locations.directions(drawers['2']!)).at(-1)).toEqual({
      name: 'Allen keys',
      type: 'drawer',
      position: { n: 2, of: 3, from: 'left' },
    });
  });
});
