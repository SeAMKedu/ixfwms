import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

/** A drone case on a shelf: the drone, its controller, three batteries, and spare propellers. */
async function droneCase() {
  const { locations, parts, units, stock } = env.services;
  const room = await locations.create({ name: 'Robotics lab', type: 'room' }, env.admin);
  const shelf = await locations.create(
    { name: 'Shelf 3', type: 'shelf', parent: room.code },
    env.admin,
  );
  const bench = await locations.create(
    { name: 'Workbench 2', type: 'workstation', parent: room.code },
    env.admin,
  );
  const box = await locations.create(
    { name: 'Drone case', type: 'box', parent: shelf.code },
    env.admin,
  );
  const drone = await parts.create({ name: 'Drone', kind: 'device', status: 'active' }, env.admin);
  const battery = await parts.create(
    { name: 'Drone battery', kind: 'part', status: 'active' },
    env.admin,
  );
  const props = await parts.create(
    { name: 'Propeller', kind: 'part', status: 'active' },
    env.admin,
  );
  const [aircraft, rc] = await units.add(
    { part: drone.code, units: [{ name: 'Drone 1' }, { name: 'RC 1' }], location: box.code },
    env.admin,
  );
  const batteries = await units.add(
    {
      part: battery.code,
      units: [{ name: 'B1' }, { name: 'B2' }, { name: 'B3' }],
      location: box.code,
    },
    env.admin,
  );
  const lot = await stock.add(
    { part: props.code, location: box.code, amount: { mode: 'count', quantity: 8 } },
    env.admin,
  );
  return { room, shelf, bench, box, drone, battery, aircraft: aircraft!, rc: rc!, batteries, lot };
}

describe('lending a whole container', () => {
  it('lends a case with everything in it, and nothing moves in or out until it is back', async () => {
    const { shelf, bench, box, drone, aircraft, batteries, lot } = await droneCase();
    const { loans, units, locations, stock, carry, parts, where, auth } = env.services;
    await auth.createUser('teacher', 'member');

    const loan = await loans.lendPlace(
      box.code,
      { responsible: 'teacher', description: 'Field tests for a thesis', dueAt: '2020-01-31' },
      env.admin,
    );
    expect(loan).toMatchObject({ unit: null, place: { code: box.code }, overdue: true });
    const out = await env.services.locationViews.detail(box.code);
    expect(out).toMatchObject({ outOfLab: true, loan: { id: loan.id } });
    expect(out.path[0]!.kind).toBe('away');
    expect((await loans.list(true)).map((l) => l.place?.code)).toEqual([box.code]);

    const drone1 = await units.detail(aircraft.code, env.admin);
    expect(drone1.loan).toMatchObject({ id: loan.id, place: { name: 'Drone case' } });
    expect(drone1.events[0]).toMatchObject({ kind: 'lent', value: 'Drone case' });
    expect((await where.ask('Drone 1'))[0]!.text).toMatch(
      /^Drone 1: lent out of the lab in Drone case, teacher is responsible/,
    );
    expect(
      (await parts.search({ inStock: true, limit: 10, offset: 0 })).items.map((p) => p.code),
    ).not.toContain(drone.code);

    const lent = /Drone case is lent out of the lab/;
    await expect(units.move(aircraft.code, bench.code, env.admin)).rejects.toThrow(lent);
    await expect(
      loans.lendUnit(batteries[0]!.code, { description: 'x' }, env.admin),
    ).rejects.toThrow(lent);
    await expect(stock.move(lot.id, bench.code, null, env.admin)).rejects.toThrow(lent);
    await expect(
      stock.add(
        { part: lot.partId, location: box.code, amount: { mode: 'count', quantity: 1 } },
        env.admin,
      ),
    ).rejects.toThrow(lent);
    await expect(carry.pick({ location: box.code }, env.admin)).rejects.toThrow(lent);
    await expect(locations.move(bench.code, box.code, env.admin)).rejects.toThrow(lent);
    await expect(
      locations.create({ name: 'Bag', type: 'box', parent: box.code }, env.admin),
    ).rejects.toThrow(lent);
    await expect(loans.lendPlace(box.code, { description: 'x' }, env.admin)).rejects.toThrow(lent);
    await expect(env.services.deletes.location(box.code, env.admin)).rejects.toThrow(lent);
    await expect(env.services.deletes.unit(batteries[0]!.code, env.admin)).rejects.toThrow(
      /lent out/,
    );
    expect((await locations.allWithPaths()).find((p) => p.code === shelf.code)?.outOfLab).toBe(
      false,
    );
  });

  it('takes it back where it was, and marks what did not come back lost', async () => {
    const { shelf, box, aircraft, rc, batteries } = await droneCase();
    const { loans, units, locations } = env.services;
    await loans.lendPlace(box.code, { description: 'Fair' }, env.admin);
    await expect(
      loans.returnPlace(box.code, { missing: [shelf.code] }, env.admin),
    ).rejects.toThrow();

    const back = await loans.returnPlace(box.code, { missing: [batteries[2]!.code] }, env.admin);
    expect(back.returnedAt).not.toBeNull();
    const here = await env.services.locationViews.detail(box.code);
    expect(here).toMatchObject({ outOfLab: false, loan: null });
    expect(here.path.map((p) => p.code).slice(-2)).toEqual([shelf.code, box.code]);
    expect(await loans.list(true)).toHaveLength(0);

    const lost = await units.detail(batteries[2]!.code, env.admin);
    expect(lost).toMatchObject({ status: 'lost', loan: null });
    const kept = await units.detail(rc.code, env.admin);
    expect(kept.events.map((e) => e.kind).slice(0, 2)).toEqual(['returned', 'lent']);
    await units.move(aircraft.code, shelf.code, env.admin);
    await expect(loans.returnPlace(box.code, {}, env.admin)).rejects.toThrow(/isn't lent/);
    await locations.move(box.code, null, env.admin);
  });

  it('lends only containers, and returns to the Inbox when the old place is gone', async () => {
    const { shelf, box, room } = await droneCase();
    const { loans, locations } = env.services;
    await expect(loans.lendPlace(shelf.code, { description: 'x' }, env.admin)).rejects.toThrow(
      /Only containers/,
    );
    await expect(
      locations.move(box.code, (await locations.away()).code, env.admin),
    ).rejects.toThrow(/Lend it out/);
    const corner = await locations.create(
      { name: 'Corner', type: 'shelf', parent: room.code },
      env.admin,
    );
    const bag = await locations.create(
      { name: 'Bag', type: 'box', parent: corner.code },
      env.admin,
    );
    await loans.lendPlace(bag.code, { description: 'Demo' }, env.admin);
    await env.services.deletes.location(corner.code, env.admin);
    await loans.returnPlace(bag.code, {}, env.admin);
    expect((await env.services.locationViews.detail(bag.code)).path[0]!.kind).toBe('inbox');
  });
});
