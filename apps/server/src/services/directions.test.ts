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
});
