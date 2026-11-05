import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

async function lab() {
  const { locations, parts, units } = env.services;
  const shelf = await locations.create({ name: 'Shelf 3', type: 'shelf' }, env.admin);
  const bench = await locations.create({ name: 'Workbench', type: 'workstation' }, env.admin);
  const cabinet = await locations.create({ name: 'Cabinet B', type: 'cabinet' }, env.admin);
  const drill = await parts.create(
    { name: 'Impact drill', kind: 'tool', status: 'active' },
    env.admin,
  );
  const [unit] = await units.add(
    { part: drill.code, units: [{ name: 'Drill 2' }], home: shelf.code },
    env.admin,
  );
  await units.move(unit!.code, bench.code, env.admin);
  return { shelf, bench, cabinet, drill, unit: unit! };
}

describe('lost units', () => {
  it("aren't available, show in the Inbox, and say so when asked where they are", async () => {
    const { drill, unit } = await lab();
    const { units, bom, where } = env.services;
    await units.update(unit.code, { status: 'lost' }, env.admin);
    expect((await units.attention(env.admin)).map((a) => [a.unit.name, a.unit.status])).toEqual([
      ['Drill 2', 'lost'],
    ]);
    expect((await bom.check([{ ref: drill.code, quantity: 1 }])).lines[0]!.available).toBe(0);
    const [answer] = await where.ask('drill');
    expect(answer!.text).toMatch(/Marked lost/);
  });

  it('is found by anyone back home, or by a logged-in person where it turned up', async () => {
    const { shelf, cabinet, unit } = await lab();
    const { units, open } = env.services;
    await expect(open.foundUnit(unit.code, null, null, env.admin)).rejects.toThrow(
      /isn't marked lost/,
    );
    await units.update(unit.code, { status: 'lost' }, env.admin);
    // Someone without an account: back home, with the name they give.
    const back = await open.foundUnit(unit.code, null, 'Pekka', null);
    expect([back.status, back.location.name]).toEqual(['ok', 'Shelf 3']);
    expect(back.events.map((e) => [e.kind, e.by])).toContainEqual(['found', 'Pekka']);
    expect(shelf.code).toBe(back.home!.code);

    await units.update(unit.code, { status: 'lost' }, env.admin);
    // Not somewhere else without logging in; logged in, anywhere.
    await expect(open.foundUnit(unit.code, cabinet.code, null, null)).rejects.toThrow(/Log in/);
    const there = await open.foundUnit(unit.code, cabinet.code, null, env.admin);
    expect([there.status, there.location.name]).toEqual(['ok', 'Cabinet B']);
  });
});
