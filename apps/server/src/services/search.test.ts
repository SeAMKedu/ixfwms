import type { SessionUser } from '@ixfwms/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../test/harness.js';
import { fillSearchText } from './search-text.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

const active = { status: 'active' as const };

/** Search results as the names you'd see: a bulk item's name, or a unit's. */
async function names(input: Parameters<TestEnv['services']['parts']['search']>[0]) {
  const r = await env.services.parts.search(input);
  const byId = new Map(r.items.map((p) => [p.id, p]));
  return {
    total: r.total,
    rows: r.rows.map((row) => {
      if ('buildId' in row) return r.builds.find((b) => b.id === row.buildId)!.name;
      const p = byId.get(row.partId)!;
      return row.unitId ? p.units.find((u) => u.id === row.unitId)!.name : p.name;
    }),
  };
}

describe('search results', () => {
  it('pages by the things you can open: each live unit of a tool, one row per bulk item', async () => {
    const { parts, units } = env.services;
    await parts.create({ ...active, name: 'Allen keys' }, env.admin);
    const drill = await parts.create({ ...active, name: 'Drill', kind: 'tool' }, env.admin);
    const added = await units.add(
      {
        part: drill.code,
        units: [
          { name: 'Drill C' },
          { name: 'Drill A', serialNo: 'SN-1' },
          { name: 'Drill B' },
          { name: 'Drill D' },
        ],
      },
      env.admin,
    );
    await units.update(added[3]!.code, { status: 'archived' }, env.admin);
    await parts.create({ ...active, name: 'Zip ties' }, env.admin);

    // Part name, then unit name; the archived drill isn't listed. A page may end mid-tool.
    const all = ['Allen keys', 'Drill A', 'Drill B', 'Drill C', 'Zip ties'];
    expect(await names({ limit: 50, offset: 0 })).toEqual({ total: 5, rows: all });
    expect(await names({ limit: 2, offset: 0 })).toEqual({ total: 5, rows: all.slice(0, 2) });
    expect(await names({ limit: 2, offset: 2 })).toEqual({ total: 5, rows: all.slice(2, 4) });
    expect(await names({ limit: 2, offset: 4 })).toEqual({ total: 5, rows: all.slice(4) });

    // Naming a unit lists only it; naming the item lists every live unit.
    expect(await names({ q: 'sn-1', limit: 50, offset: 0 })).toEqual({
      total: 1,
      rows: ['Drill A'],
    });
    expect(await names({ q: added[2]!.code, limit: 50, offset: 0 })).toEqual({
      total: 1,
      rows: ['Drill B'],
    });
    expect((await names({ q: 'drill', limit: 50, offset: 0 })).rows).toEqual([
      'Drill A',
      'Drill B',
      'Drill C',
    ]);
    // Inbox and counts ask for one row per part.
    expect(await names({ q: 'drill', byUnit: false, limit: 50, offset: 0 })).toEqual({
      total: 1,
      rows: ['Drill'],
    });
  });

  it('matches a category and what is below it, even with % or _ in its name', async () => {
    const { parts } = env.services;
    await parts.create({ ...active, name: 'Right', category: 'A_B/Inner' }, env.admin);
    await parts.create({ ...active, name: 'Wrong', category: 'AxB/Inner' }, env.admin);
    await parts.create({ ...active, name: 'Also wrong', category: '100%/Inner' }, env.admin);
    await parts.create({ ...active, name: 'Hundred', category: '100%' }, env.admin);
    expect((await names({ category: 'a_b', limit: 50, offset: 0 })).rows).toEqual(['Right']);
    expect((await names({ category: '100%', limit: 50, offset: 0 })).rows).toEqual([
      'Also wrong',
      'Hundred',
    ]);
    expect((await names({ category: '100', limit: 50, offset: 0 })).rows).toEqual([]);
  });

  it('folds case beyond A–Z: SÄHKÖ finds sähkö, and % in the text is just a character', async () => {
    const { parts } = env.services;
    await parts.create(
      { ...active, name: 'SÄHKÖKAAPPI', category: 'Sähkö', tags: ['Äänitys'] },
      env.admin,
    );
    await parts.create({ ...active, name: 'Grease 100% silicone' }, env.admin);
    await parts.create({ ...active, name: 'Grease 1000 lithium' }, env.admin);
    const found = async (input: object) => (await names({ limit: 50, offset: 0, ...input })).rows;
    expect(await found({ q: 'sähkö' })).toEqual(['SÄHKÖKAAPPI']);
    expect(await found({ category: 'SÄHKÖ' })).toEqual(['SÄHKÖKAAPPI']);
    expect(await found({ tags: ['ÄÄNITYS'] })).toEqual(['SÄHKÖKAAPPI']);
    expect(await found({ tags: ['ÄÄNITYS', 'Ei ole'] })).toEqual([]);
    await parts.create(
      { ...active, name: 'Mikrofoni', tags: ['Äänitys', 'Lainattava'] },
      env.admin,
    );
    expect(await found({ tags: ['äänitys', 'lainattava'] })).toEqual(['Mikrofoni']);
    expect(await found({ q: '100%' })).toEqual(['Grease 100% silicone']);
    // A renamed part is found by its new name only.
    const cabinet = (await parts.search({ q: 'sähkö', limit: 1, offset: 0 })).items[0]!;
    await parts.update(cabinet.code, { name: 'Jakokeskus' }, env.admin);
    expect(await found({ q: 'sähkö' })).toEqual([]);
    expect(await found({ q: 'JAKO' })).toEqual(['Jakokeskus']);
  });

  it('fills in search text for rows from before it was stored', async () => {
    await env.services.parts.create({ ...active, name: 'Ölkännu' }, env.admin);
    await env.database.client.execute('UPDATE parts SET search_text = NULL');
    expect((await names({ q: 'ÖLK', limit: 50, offset: 0 })).rows).toEqual([]);
    await fillSearchText(env.database.db);
    expect((await names({ q: 'ÖLK', limit: 50, offset: 0 })).rows).toEqual(['Ölkännu']);
  });
});

describe('searching within a place', () => {
  it('lists only what is there, and units that belong there', async () => {
    const { locations, parts, units, stock } = env.services;
    const labA = await locations.create({ name: 'Lab A', type: 'room' }, env.admin);
    const labB = await locations.create({ name: 'Lab B', type: 'room' }, env.admin);
    const screw = await parts.create({ name: 'Screw', kind: 'part', status: 'active' }, env.admin);
    await stock.add(
      { part: screw.code, location: labA.code, amount: { mode: 'count', quantity: 5 } },
      env.admin,
    );
    await stock.add(
      { part: screw.code, location: labB.code, amount: { mode: 'count', quantity: 7 } },
      env.admin,
    );
    const drill = await parts.create({ name: 'Drill', kind: 'tool', status: 'active' }, env.admin);
    const [inA] = await units.add(
      { part: drill.code, units: [{}], location: labA.code },
      env.admin,
    );
    const [inB] = await units.add(
      { part: drill.code, units: [{}], location: labB.code },
      env.admin,
    );
    // Belongs to Lab A, visiting Lab B.
    const [visiting] = await units.add(
      { part: drill.code, units: [{}], location: labB.code, home: labA.code },
      env.admin,
    );

    const found = await parts.search({ location: labA.code, limit: 50, offset: 0 });
    const unitIds = found.rows.flatMap((r) => ('unitId' in r && r.unitId ? [r.unitId] : []));
    expect(unitIds).toContain(inA!.id);
    expect(unitIds).toContain(visiting!.id);
    expect(unitIds).not.toContain(inB!.id);
    const listed = found.items.find((i) => i.id === screw.id)!;
    expect(listed.stock.map((s) => s.locationCode)).toEqual([labA.code]);
  });

  it('home place: remembered for the session, forgotten when the place is deleted', async () => {
    const { locations, auth, deletes } = env.services;
    const lab = await locations.create({ name: 'Lab A', type: 'room' }, env.admin);
    const headers = { authorization: `Bearer ${env.inventoryToken}` };
    const put = await env.app.inject({
      method: 'PATCH',
      url: '/api/session',
      headers,
      payload: { home: lab.code },
    });
    expect(put.json()).toEqual({ home: { code: lab.code, name: 'Lab A' }, language: null });
    const session = await env.app.inject({ url: '/api/session', headers });
    expect(session.json<SessionUser>().home?.code).toBe(lab.code);
    await deletes.location(lab.code, env.admin);
    expect((await auth.settings(env.inventory.userId)).home).toBeNull();
  });
});
