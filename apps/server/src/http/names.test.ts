import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { viewAs } from '../services/context.js';
import { createTestEnv, type TestEnv } from '../test/harness.js';

let env: TestEnv;
let readToken: string;
beforeEach(async () => {
  env = await createTestEnv();
  readToken = (await env.services.auth.createToken('assistant', 'reader', ['read'])).token;
});
afterEach(async () => env.cleanup());

/**
 * A drill lent to Ulla, a problem Pekka (no account) reported, and a box Ulla is carrying: every
 * kind of record that has a person's name on it.
 */
async function named() {
  const { auth, locations, parts, units, carry } = env.services;
  await auth.createUser('Ulla', 'member');
  const ulla = (await auth.verify((await auth.createToken('Ulla', 'test', ['inventory'])).token))!;
  const room = await locations.create({ name: 'Robotics lab', type: 'room' }, env.admin);
  const box = await locations.create({ name: 'Box', type: 'box', parent: room.code }, env.admin);
  const drill = await parts.create(
    { name: 'Impact drill', kind: 'tool', status: 'active' },
    env.admin,
  );
  const [unit] = await units.add({ part: drill.code, units: [{ name: 'Drill 2' }] }, ulla);
  await env.services.loans.lendUnit(
    unit!.code,
    { responsible: 'Ulla', description: 'Thesis tests' },
    ulla,
  );
  const report = await env.app.inject({
    method: 'POST',
    url: '/api/reports',
    payload: { owner: 'unit', ref: unit!.code, kind: 'broken', note: 'Chuck slips', name: 'Pekka' },
  });
  expect(report.statusCode).toBe(201);
  await carry.pick({ location: box.code }, ulla);
  return { unit: unit!, box };
}

const get = (url: string, token?: string) =>
  env.app.inject({ url, headers: token ? { authorization: `Bearer ${token}` } : {} });

describe('names for readers without a login', () => {
  it('keeps what happened but leaves out who', async () => {
    const { unit, box } = await named();
    const urls = [
      '/api/loans',
      '/api/reports',
      '/api/history',
      `/api/units/${unit.code}`,
      '/api/locations',
      `/api/locations/${box.code}`,
      '/api/carry/all',
    ];
    for (const url of urls) {
      const anon = await get(url);
      expect(anon.statusCode, url).toBe(200);
      expect(anon.body, url).not.toMatch(/Ulla|Pekka/);
      const read = await get(url, readToken);
      expect(read.body, url).toMatch(/Ulla|Pekka/);
    }

    const [loan] = (await get('/api/loans')).json<Record<string, unknown>[]>();
    expect(loan).toMatchObject({ responsible: null, description: null, overdue: false });
    const [report] = (await get('/api/reports')).json<Record<string, unknown>[]>();
    // What was wrong needs a login too, unless the lab shows readers everything.
    expect(report).toMatchObject({ by: null, kind: 'broken', note: null });
    const detail = (await get(`/api/units/${unit.code}`)).json<{
      loan: Record<string, unknown>;
      events: { kind: string; by: string | null }[];
    }>();
    expect(detail.loan).toMatchObject({ responsible: null, description: null });
    expect(detail.events.map((e) => e.kind)).toContain('lent');
    expect(detail.events.every((e) => e.by === null)).toBe(true);
    const history = (await get('/api/history')).json<{ user: string | null }[]>();
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((e) => e.user === null)).toBe(true);

    const carried = (await get('/api/locations')).json<{ kind: string; name: string }[]>();
    expect(carried.find((l) => l.kind === 'in_transit')).toMatchObject({ name: 'Being carried' });
    const shown = (await get('/api/locations', readToken)).json<{ kind: string; name: string }[]>();
    expect(shown.find((l) => l.kind === 'in_transit')).toMatchObject({ name: 'Carried by Ulla' });
    const inBox = (await get(`/api/locations/${box.code}`)).json<{ path: { name: string }[] }>();
    expect(inBox.path.map((p) => p.name)).toEqual(['Being carried', 'Box']);
  });

  it('leaves names out of service views run for an anonymous caller', async () => {
    const { unit } = await named();
    const { units, reports } = env.services;
    const anon = await viewAs(null, () => units.detail(unit.code, null));
    expect(anon.loan?.responsible).toBeNull();
    expect(anon.reports[0]?.by).toBeNull();
    expect(anon.location.name).toBe('Out of the lab');
    expect((await viewAs(null, () => reports.list(true)))[0]?.by).toBeNull();
    const shown = await viewAs(env.admin, () => units.detail(unit.code, env.admin));
    expect(shown.loan?.responsible).toBe('Ulla');
    expect(shown.reports[0]?.by).toBe('Pekka');
  });

  it('leaves out serial numbers, notes and firmware unless the lab shows them', async () => {
    const { locations, parts, units, stock, settings } = env.services;
    const room = await locations.create({ name: 'Robotics lab', type: 'room' }, env.admin);
    const pallet = await locations.create(
      { name: 'Pallet', type: 'pallet', parent: room.code, contact: 'Ulla, 040 123' },
      env.admin,
    );
    const robot = await parts.create(
      { name: 'Robot arm', kind: 'device', status: 'active', notes: 'Key in the drawer' },
      env.admin,
    );
    const [unit] = await units.add(
      { part: robot.code, units: [{ serialNo: 'SN-4471', notes: 'Spare cable' }] },
      env.admin,
    );
    await units.log(unit!.code, { kind: 'firmware', value: 'V4.6' }, env.admin);
    await units.log(unit!.code, { kind: 'note', text: 'Recalibrated' }, env.admin);
    const screws = await parts.create({ name: 'M3 screw', status: 'active' }, env.admin);
    await stock.add(
      {
        part: screws.code,
        location: pallet.code,
        amount: { mode: 'count', quantity: 5 },
        note: 'Bag 2',
      },
      env.admin,
    );
    const secrets = /SN-4471|Spare cable|V4\.6|Recalibrated|Key in the drawer|Bag 2|Ulla/;
    const urls = [
      `/api/units/${unit!.code}`,
      `/api/parts/${robot.code}`,
      `/api/parts/${screws.code}`,
      `/api/locations/${pallet.code}`,
      `/api/parts?q=robot`,
      '/api/history',
      `/?q=robot`,
    ];
    for (const url of urls) {
      expect((await get(url)).body, url).not.toMatch(secrets);
      expect((await get(url, readToken)).body, url).toMatch(secrets);
    }
    expect((await get(`/api/units/${unit!.code}`)).json()).toMatchObject({
      serialNo: null,
      notes: null,
      firmware: null,
    });

    // Contacts are people: hidden whatever the setting. The rest shows when the lab chooses.
    await settings.update({ anonymousView: 'full' }, env.admin);
    expect((await get(`/api/locations/${pallet.code}`)).json()).toMatchObject({ contact: null });
    expect((await get(`/api/units/${unit!.code}`)).json()).toMatchObject({
      serialNo: 'SN-4471',
      notes: 'Spare cable',
      firmware: { version: 'V4.6' },
    });
  });

  it('keeps the export for admins', async () => {
    await named();
    expect((await get('/api/export')).statusCode).toBe(401);
    expect((await get('/api/export', readToken)).statusCode).toBe(403);
    const res = await get('/api/export', env.adminToken);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/Carried by Ulla/);
    expect(res.body).toMatch(/Pekka/);
  });
});
