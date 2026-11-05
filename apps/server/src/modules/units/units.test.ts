import type { UnitDetail, WriteOffRow } from '@ixfwms/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

/** A shelf the drill lives on, a workstation, and an impact drill with one unit at home. */
async function lab() {
  const { locations, parts, units } = env.services;
  const room = await locations.create({ name: 'Robotics lab', type: 'room' }, env.admin);
  const shelf = await locations.create(
    { name: 'Shelf 3', type: 'shelf', parent: room.code },
    env.admin,
  );
  const bench = await locations.create(
    { name: 'Workbench 2', type: 'workstation', parent: room.code },
    env.admin,
  );
  const drill = await parts.create(
    {
      name: 'Impact drill DTD153',
      kind: 'tool',
      aliases: ['impact driver', 'iskuporakone'],
      status: 'active',
    },
    env.admin,
  );
  const [unit] = await units.add(
    { part: drill.code, units: [{ name: 'Drill 2', serialNo: 'SN-778' }], home: shelf.code },
    env.admin,
  );
  return { room, shelf, bench, drill, unit: unit! };
}

describe('units of individually tracked items', () => {
  it('switches an item without stock to individual, and refuses amounts for it', async () => {
    const { drill, unit, shelf } = await lab();
    const item = await env.services.parts.get(drill.code);
    expect(item).toMatchObject({ kind: 'tool', tracking: 'individual' });
    expect(item.units.map((u) => [u.name, u.atHome])).toEqual([['Drill 2', true]]);
    expect(unit.location.code).toBe(shelf.code);
    await expect(
      env.services.stock.add(
        { part: drill.code, amount: { mode: 'count', quantity: 1 } },
        env.admin,
      ),
    ).rejects.toThrow(/one by one/);
    await expect(
      env.services.parts.update(drill.code, { tracking: 'bulk' }, env.admin),
    ).rejects.toThrow(/has units/);
    expect((await env.services.labels.lookup(unit.code)).assigned).toBe('unit');
    const [label] = await env.services.labels.forCodes([unit.code], 'http://lab.test');
    expect(label).toMatchObject({ kind: 'unit', name: 'Drill 2', address: 'RL-3' });
  });

  it('keeps units in the order they were added', async () => {
    const { drill, shelf } = await lab();
    const added = await env.services.units.add(
      {
        part: drill.code,
        units: Array.from({ length: 6 }, (_, i) => ({ name: `Drill ${i + 3}` })),
        home: shelf.code,
      },
      env.admin,
    );
    const names = ['Drill 3', 'Drill 4', 'Drill 5', 'Drill 6', 'Drill 7', 'Drill 8'];
    expect(added.map((u) => u.name)).toEqual(names);
    expect((await env.services.parts.get(drill.code)).units.map((u) => u.name)).toEqual([
      'Drill 2',
      ...names,
    ]);
  });

  it('finds items by alias, unit name and serial number, and says where they are', async () => {
    const { drill, unit, bench } = await lab();
    const { parts, where } = env.services;
    for (const q of ['iskuporakone', 'drill 2', 'sn-778', unit.code])
      expect((await parts.search({ q, limit: 10, offset: 0 })).items.map((p) => p.code)).toEqual([
        drill.code,
      ]);
    expect((await parts.search({ kind: 'part', limit: 10, offset: 0 })).total).toBe(0);

    expect((await where.ask('impact driver'))[0]!.text).toMatch(/^Drill 2: at RL-3\.$/);
    await env.services.units.move(unit.code, bench.code, env.admin);
    expect((await where.ask('impact driver'))[0]!.text).toBe(
      'Drill 2: now at RL-2; it belongs at RL-3.',
    );
  });

  it('lends a unit out of the lab and takes it back home', async () => {
    const { unit, shelf } = await lab();
    const { units, auth } = env.services;
    await auth.createUser('teacher', 'member');
    const lent = await env.services.loans.lendUnit(
      unit.code,
      { responsible: 'teacher', description: 'Thesis tests at Company X', dueAt: '2020-01-31' },
      env.admin,
    );
    expect(lent.location.kind).toBe('away');
    expect(lent.loan).toMatchObject({ responsible: 'teacher', overdue: true });
    expect((await env.services.loans.list(true, env.admin)).map((l) => l.unit?.code)).toEqual([
      unit.code,
    ]);
    await expect(units.move(unit.code, shelf.code, env.admin)).rejects.toThrow(/return it/);
    await expect(
      env.services.loans.lendUnit(
        unit.code,
        { responsible: 'nobody', description: 'x' },
        env.admin,
      ),
    ).rejects.toThrow(/already lent/);

    const back = await env.services.loans.returnUnit(unit.code, null, env.admin);
    expect(back).toMatchObject({ atHome: true, loan: null });
    expect(back.events.map((e) => e.kind).slice(0, 2)).toEqual(['returned', 'lent']);
    expect(await env.services.loans.list(true, env.admin)).toHaveLength(0);
  });

  it('keeps a log with firmware versions and the next check date', async () => {
    const { unit } = await lab();
    const { units } = env.services;
    await units.log(unit.code, { kind: 'firmware', value: 'V4.6', text: 'TIA update' }, env.admin);
    const after = await units.log(
      unit.code,
      { kind: 'maintenance', text: 'Electrical safety check', nextCheckAt: '2020-06-01' },
      env.admin,
    );
    expect(after.firmware?.version).toBe('V4.6');
    expect(after.checkDue).toBe(true);
    expect((await units.attention(env.admin)).map((a) => [a.unit.code, a.reason])).toEqual([
      [unit.code, 'check_due'],
    ]);
    await expect(units.log(unit.code, { kind: 'firmware' }, env.admin)).rejects.toThrow(/version/);
  });

  it('hides network details from people without an account', async () => {
    const { unit } = await lab();
    const { units } = env.services;
    await units.update(unit.code, { ipAddress: '10.0.0.10', hostname: 'drill' }, env.admin);
    await env.services.units.add(
      {
        part: (await units.detail(unit.code, env.admin)).part.code,
        units: [{ ipAddress: '10.0.0.9' }],
      },
      env.admin,
    );
    expect(await units.detail(unit.code, null)).toMatchObject({
      ipAddress: null,
      networkHidden: true,
    });
    expect((await units.detail(unit.code, env.admin)).ipAddress).toBe('10.0.0.10');
    await expect(units.network(null)).rejects.toThrow();
    expect((await units.network(env.admin)).map((n) => n.ipAddress)).toEqual([
      '10.0.0.9',
      '10.0.0.10',
    ]);
    const csv = await env.app.inject({ url: '/api/network.csv', headers: auth() });
    expect(csv.body.split('\r\n')[1]).toMatch(/^"10\.0\.0\.9"/);
  });
});

const auth = () => ({ authorization: `Bearer ${env.adminToken}` });

describe('units in the item list filters', () => {
  it('finds items by where their units are, and counts usable units as stock', async () => {
    const { room, shelf, bench, drill, unit } = await lab();
    const { parts, units, auth } = env.services;
    const search = (f: object) =>
      parts.search({ limit: 10, offset: 0, ...f }).then((r) => r.items.map((p) => p.code));

    expect(await search({ location: room.code })).toEqual([drill.code]);
    expect(await search({ location: shelf.code })).toEqual([drill.code]);
    expect(await search({ location: bench.code })).toEqual([]);
    expect(await search({ inStock: true })).toEqual([drill.code]);

    // Two wanted, one there: low.
    await parts.update(drill.code, { minStock: 2 }, env.admin);
    expect(await search({ lowStock: true })).toEqual([drill.code]);
    await units.add({ part: drill.code, units: [{}], home: shelf.code }, env.admin);
    expect(await search({ lowStock: true })).toEqual([]);

    // Lent out or broken, a unit isn't stock any more.
    await auth.createUser('teacher', 'member');
    await env.services.loans.lendUnit(
      unit.code,
      { responsible: 'teacher', description: 'Thesis' },
      env.admin,
    );
    expect(await search({ lowStock: true })).toEqual([drill.code]);
    const other = (await parts.get(drill.code)).units.find((u) => u.code !== unit.code)!;
    await units.update(other.code, { status: 'broken' }, env.admin);
    expect(await search({ inStock: false })).toEqual([drill.code]);
  });
});

describe('problem reports', () => {
  it('lets anyone report a broken unit, and resolving it makes the unit OK again', async () => {
    const { unit } = await lab();
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/reports',
      payload: {
        owner: 'unit',
        ref: unit.code,
        kind: 'broken',
        note: 'Chuck slips',
        name: 'Pekka',
      },
    });
    expect(res.statusCode).toBe(201);
    const report = res.json<{ id: string; by: string; guest: boolean }>();
    // Without a login, the answer leaves the name out; it's still recorded.
    expect(report).toMatchObject({ by: null, guest: true });
    const broken = await env.services.units.detail(unit.code, null);
    expect(broken.status).toBe('broken');
    expect(broken.reports).toHaveLength(1);
    expect(broken.events[0]).toMatchObject({ kind: 'problem', value: 'broken', by: 'Pekka' });

    await expect(env.services.reports.resolve(report.id, 'New chuck', null)).rejects.toThrow();
    await env.services.reports.resolve(report.id, 'New chuck', env.admin);
    const fixed = await env.services.units.detail(unit.code, null);
    expect(fixed).toMatchObject({ status: 'ok', reports: [] });
    expect(fixed.events[0]).toMatchObject({ kind: 'repaired', text: 'New chuck' });
    expect(await env.services.reports.list(true)).toHaveLength(0);
  });
});

describe('without an account', () => {
  it('brings things to a workstation and clears it again', async () => {
    const { unit, shelf, bench, room } = await lab();
    const { open, parts, carry } = env.services;
    const cups = await parts.create(
      {
        name: 'Suction cup',
        status: 'active',
        stock: { location: shelf.code, amount: { mode: 'count', quantity: 10 } },
      },
      env.admin,
    );
    // A student brings the drill and three suction cups to the bench.
    const there = await open.moveUnit(unit.code, bench.code, 'Pekka', null);
    expect(there.events[0]).toMatchObject({ kind: 'moved', by: 'Pekka', guest: true });
    await open.moveLot(cups.lots[0]!.id, bench.code, 3, 'Pekka', null);
    // …but can't put things just anywhere.
    await expect(open.moveUnit(unit.code, room.code, null, null)).rejects.toThrow(/Log in/);

    // Things carried by someone logged in remember where they came from too.
    const tape = await parts.create(
      {
        name: 'Tape',
        status: 'active',
        stock: { location: shelf.code, amount: { mode: 'level', level: 'plenty' } },
      },
      env.admin,
    );
    await carry.pick({ lotId: tape.lots[0]!.id }, env.admin);
    await carry.drop(bench.code, null, env.admin);

    const result = await open.clear(bench.code, null, null);
    expect(result.returned.map((r) => [r.name, r.to.code]).sort()).toEqual([
      ['Drill 2', shelf.code],
      ['Suction cup', shelf.code],
      ['Tape', shelf.code],
    ]);
    expect(result.left).toEqual([]);
    expect((await parts.get(cups.code)).lots.map((l) => l.amount.quantity)).toEqual([10]);
    await expect(open.clear(shelf.code, null, env.admin)).rejects.toThrow(/workstations/);
  });

  it('follows the lab setting', async () => {
    const { unit, bench } = await lab();
    const { open, settings, units } = env.services;
    await units.move(unit.code, bench.code, env.admin);
    await settings.update({ anonymousActions: 'report' }, env.admin);
    await expect(open.putBackUnit(unit.code, null, null)).rejects.toThrow(/Log in/);
    await settings.update({ anonymousActions: 'put_back' }, env.admin);
    expect((await open.putBackUnit(unit.code, null, null)).atHome).toBe(true);
    await expect(open.moveUnit(unit.code, bench.code, null, null)).rejects.toThrow(/Log in/);
  });

  it('carries units with the rest', async () => {
    const { unit, bench } = await lab();
    const { carry } = env.services;
    const state = await carry.pick({ unit: unit.code }, env.admin);
    expect(state.items).toMatchObject([{ kind: 'unit', code: unit.code }]);
    await carry.drop(bench.code, null, env.admin);
    expect((await env.services.locationViews.detail(bench.code)).units.map((u) => u.code)).toEqual([
      unit.code,
    ]);
  });
});

describe('purchase details', () => {
  it('are for members, and removed units reach the write-off list', async () => {
    const { locations, parts, units } = env.services;
    const room = await locations.create({ name: 'Lab', type: 'room' }, env.admin);
    const part = await parts.create({ name: 'Scope', kind: 'device', status: 'active' }, env.admin);
    const [unit, plain] = await units.add(
      { part: part.code, units: [{}, {}], location: room.code },
      env.admin,
    );
    await units.update(
      unit!.code,
      {
        purchaseDate: '2024-03-01',
        purchaseValueCents: 123450,
        costCenter: '4100',
        usefulLifeYears: 5,
      },
      env.admin,
    );
    const member = { authorization: `Bearer ${env.inventoryToken}` };
    const anon = await env.app.inject({ url: `/api/units/${unit!.code}` });
    expect(anon.json<UnitDetail>().purchase).toBeNull();
    expect(anon.body).not.toContain('4100');
    const seen = await env.app.inject({ url: `/api/units/${unit!.code}`, headers: member });
    expect(seen.json<UnitDetail>().purchase).toEqual({
      date: '2024-03-01',
      valueCents: 123450,
      costCenter: '4100',
      usefulLifeYears: 5,
    });

    expect((await env.app.inject({ url: '/api/write-offs' })).statusCode).toBe(401);
    const list = async () =>
      (await env.app.inject({ url: '/api/write-offs', headers: member })).json<WriteOffRow[]>();
    expect((await list()).map((r) => [r.code, r.removedAt])).toEqual([[unit!.code, null]]);

    await units.update(unit!.code, { status: 'archived' }, env.admin);
    await units.update(plain!.code, { status: 'lost' }, env.admin);
    const after = await list();
    expect(after.map((r) => r.code).sort()).toEqual([unit!.code, plain!.code].sort());
    expect(after.every((r) => r.removedAt)).toBe(true);
  });
});
