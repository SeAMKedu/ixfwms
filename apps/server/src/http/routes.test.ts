import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../test/harness.js';
import { readVersion } from '../version.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

type Json = Record<string, unknown>;

async function req<T = Json>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  token = env.adminToken,
) {
  const res = await env.app.inject({
    method,
    url,
    payload: payload as Json,
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode}: ${res.body}`);
  return res.statusCode === 204 ? (undefined as T) : res.json<T>();
}

describe('REST routes, end to end', () => {
  it('covers places, parts, stock and pages in one realistic flow', async () => {
    const lab = await req<{ code: string }>('POST', '/api/locations', {
      name: 'Robotics lab',
      type: 'room',
    });
    const cab = await req<{ code: string }>('POST', '/api/locations', {
      name: 'Cabinet A',
      type: 'cabinet',
      parent: lab.code,
    });
    const box = await req<{ code: string }>('POST', '/api/locations', {
      name: 'Box',
      parent: cab.code,
    });
    const cell = await req<{ code: string }>('POST', '/api/locations', {
      name: 'Robot cell 2',
      type: 'zone',
      parent: lab.code,
    });
    await req('PATCH', `/api/locations/${box.code}`, {
      name: 'Box: vacuum parts',
      description: 'Schmalz and Festo',
    });
    expect((await req<unknown[]>('GET', `/api/locations?parent=${lab.code}`)).length).toBe(2);
    const tree = await req<{ children: unknown[] }[]>('GET', '/api/locations?tree=1&depth=3');
    expect(tree.some((n) => n.children.length === 2)).toBe(true);

    const part = await req<{ code: string; lots: { id: string }[] }>('POST', '/api/parts', {
      name: 'Bellows suction cup 30',
      category: 'Pneumatics/Vacuum',
      identifiers: [{ value: 'SPB1 30 NBR-60 G1/4-IG' }],
      tags: ['Gripper v2'],
      stock: { location: box.code, amount: { mode: 'count', quantity: 14 } },
    });
    const lotId = part.lots[0]!.id;
    await req('PATCH', `/api/parts/${part.code}`, {
      manufacturer: 'Schmalz',
      addTags: ['spare'],
      removeTags: ['Gripper v2'],
      attributes: { diameterMm: 30 },
    });
    await req('POST', `/api/stock/${lotId}/take`, { quantity: 2 });
    await req('POST', `/api/stock/${lotId}/stocktake`, { mode: 'count', quantity: 13 });
    const moved = await req<{ amount: { quantity: number } }>('POST', `/api/stock/${lotId}/move`, {
      to: cell.code,
      quantity: 3,
    });
    expect(moved.amount.quantity).toBe(3);
    await req('POST', '/api/stock', {
      part: part.code,
      location: box.code,
      amount: { mode: 'count', quantity: 1 },
    });
    await req('POST', `/api/locations/${box.code}/move`, { parent: cell.code });
    await req('POST', `/api/parts/${part.code}/status`, { status: 'active' });

    const detail = await req<{
      status: string;
      manufacturer: string;
      tags: string[];
      lots: unknown[];
    }>('GET', `/api/parts/${part.code}`);
    expect(detail).toMatchObject({ status: 'active', manufacturer: 'Schmalz', tags: ['spare'] });
    expect(
      (await req<{ total: number }>('GET', '/api/parts?q=suction&inStock=true&category=Pneumatics'))
        .total,
    ).toBe(1);
    expect((await req<{ total: number }>('GET', `/api/parts?location=${cell.code}`)).total).toBe(1);
    expect(await req('GET', '/api/categories')).toEqual([
      { path: 'Pneumatics', parts: 1, ownParts: 0, fields: 0 },
      { path: 'Pneumatics/Vacuum', parts: 1, ownParts: 1, fields: 0 },
    ]);
    expect(await req('GET', '/api/tags')).toEqual(
      expect.arrayContaining([{ name: 'spare', parts: 1 }]),
    );
    expect(
      (await req<unknown[]>('POST', '/api/parts/similar', { name: 'suction cup 30' })).length,
    ).toBe(1);

    const recursive = await req<{ contents: unknown[]; children: { partCount: number }[] }>(
      'GET',
      `/api/locations/${lab.code}?recursive=1`,
    );
    expect(recursive.contents.length).toBe(2);

    const att = await req<{ href: string }>('POST', '/api/attachments', {
      owner: 'part',
      ref: part.code,
      kind: 'datasheet',
      url: 'https://example.com/spb1.pdf',
      title: 'Datasheet',
    });
    expect(att.href).toBe('https://example.com/spb1.pdf');

    const partPage = await env.app.inject({ url: `/p/${part.code}` });
    expect(partPage.body).toContain('Datasheet');
    const search = await env.app.inject({ url: '/?q=suction' });
    expect(search.body).toContain('Bellows suction cup 30');
    const boxPage = await env.app.inject({ url: `/l/${box.code}` });
    expect(boxPage.body).toContain('Robot cell 2');
  });

  it('serves info, backups for admins only, and MCP over HTTP with a token', async () => {
    expect((await req<{ you: { name: string } }>('GET', '/api/info')).you.name).toBe('admin');
    const forbidden = await env.app.inject({
      method: 'POST',
      url: '/api/backups',
      headers: { authorization: `Bearer ${env.inventoryToken}` },
    });
    expect(forbidden.statusCode).toBe(403);
    expect((await req<{ file: string }>('POST', '/api/backups')).file).toMatch(/manual\.db$/);

    const anon = await env.app.inject({
      method: 'POST',
      url: '/mcp',
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(anon.statusCode).toBe(401);
    expect((await env.app.inject({ url: '/mcp' })).statusCode).toBe(405);
    const res = await env.app.inject({
      method: 'POST',
      url: '/mcp',
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      headers: {
        authorization: `Bearer ${env.inventoryToken}`,
        accept: 'application/json, text/event-stream',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ result: { tools: unknown[] } }>().result.tools.length).toBeGreaterThan(10);
  });

  it('revokes tokens', async () => {
    const { token, id } = await env.services.auth.createToken('assistant', 'temp', ['read']);
    expect(await env.services.auth.verify(token)).not.toBeNull();
    await env.services.auth.revokeToken(id);
    expect(await env.services.auth.verify(token)).toBeNull();
  });

  it('reads the release version from package.json', () => {
    expect(readVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('label and carry endpoints', () => {
  it('serves label files and the carry flow over HTTP', async () => {
    const box = await req<{ code: string }>('POST', '/api/locations', { name: 'Box' });
    const cell = await req<{ code: string }>('POST', '/api/locations', {
      name: 'Cell',
      type: 'zone',
    });
    const svg = await env.app.inject({
      url: `/api/labels/${box.code}/label.svg?tape=24`,
      headers: { host: 'ixf.local' },
    });
    expect(svg.headers['content-type']).toContain('image/svg+xml');
    expect(svg.body).toContain('18mm');
    expect(
      (await env.app.inject({ url: `/api/labels/${box.code}/qr.svg?size=20` })).body,
    ).toContain('20mm');
    expect((await env.app.inject({ url: `/api/labels/${box.code}/qr.dxf?card=1` })).body).toContain(
      'POLYLINE',
    );
    const csv = await env.app.inject({ url: `/api/labels.csv?codes=${box.code},${cell.code}` });
    expect(csv.body.split('\r\n').filter(Boolean)).toHaveLength(3);
    expect((await req<unknown[]>('GET', `/api/labels?location=${box.code}`)).length).toBe(1);
    const blank = await env.app.inject({
      method: 'POST',
      url: '/api/labels/blank',
      payload: { count: 2, format: 'csv' },
      headers: { authorization: `Bearer ${env.adminToken}` },
    });
    expect(blank.headers['content-type']).toContain('text/csv');
    expect(await req('GET', `/api/codes/${box.code}`)).toMatchObject({ assigned: 'location' });

    await req('POST', '/api/carry/pick', { location: box.code });
    expect((await req<{ items: unknown[] }>('GET', '/api/carry')).items).toHaveLength(1);
    expect(await req('POST', '/api/carry/drop', { to: cell.code })).toMatchObject({ moved: 1 });
  });
});

describe('category fields over HTTP', () => {
  it('filters with ?attr= and edits fields', async () => {
    await req('PUT', '/api/categories/fields', {
      path: 'Fasteners/Screws',
      fields: [{ key: 'lengthMm', label: 'Length', type: 'number', unit: 'mm' }],
    });
    await req('POST', '/api/parts', {
      name: 'Long screw',
      category: 'Fasteners/Screws',
      attributes: { lengthMm: 40 },
    });
    await req('POST', '/api/parts', {
      name: 'Short screw',
      category: 'Fasteners/Screws',
      attributes: { lengthMm: 8 },
    });
    const found = await req<{ items: { name: string }[] }>(
      'GET',
      `/api/parts?attr=${encodeURIComponent('lengthMm>=10')}`,
    );
    expect(found.items.map((p) => p.name)).toEqual(['Long screw']);
    const bad = await env.app.inject({
      url: `/api/parts?attr=${encodeURIComponent('lengthMm>=long')}`,
    });
    expect(bad.statusCode).toBe(400);
    expect(
      (await req<{ effective: unknown[] }>('GET', '/api/categories/fields?path=Fasteners/Screws'))
        .effective,
    ).toHaveLength(1);
    expect((await req<{ added: string[] }>('POST', '/api/categories/starter')).added).toContain(
      'Filament',
    );
  });
});

describe('import over HTTP', () => {
  it('previews by default and imports on request', async () => {
    const body = { rows: [{ name: 'Imported cup', quantity: 3 }] };
    const preview = await req<{ action: string }[]>('POST', '/api/import/parts', body);
    expect(preview[0]!.action).toBe('create');
    expect((await req<{ total: number }>('GET', '/api/parts')).total).toBe(0);
    await req('POST', '/api/import/parts', { ...body, dryRun: false });
    expect((await req<{ total: number }>('GET', '/api/parts')).total).toBe(1);
    const save = await env.app.inject({
      method: 'PUT',
      url: '/api/import/mappings',
      payload: { name: 'List', mapping: { columns: { name: 'Item' } } },
      headers: { authorization: `Bearer ${env.adminToken}` },
    });
    expect(save.statusCode).toBe(204);
    expect(await req('GET', '/api/import/mappings')).toEqual([
      { name: 'List', mapping: { columns: { name: 'Item' }, headerRow: 1 } },
    ]);
  });
});

describe('BOM over HTTP', () => {
  it('checks a list without a token and tags with one', async () => {
    const part = await req<{ code: string }>('POST', '/api/parts', {
      name: 'Cup',
      stock: { amount: { mode: 'count', quantity: 2 } },
    });
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/bom/check',
      payload: { lines: [{ ref: part.code, quantity: 1 }] },
    });
    expect(res.json()).toMatchObject({ buildable: 2 });
    expect(await req('POST', '/api/bom/tag', { codes: [part.code], tag: 'Demo' })).toEqual({
      tagged: 1,
    });
    const bad = await env.app.inject({
      method: 'POST',
      url: '/api/bom/check',
      payload: { lines: [{ quantity: 1 }] },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('maps over HTTP', () => {
  it('sets a map, reads layers, and serves the SVG sandboxed', async () => {
    const lab = await req<{ code: string }>('POST', '/api/locations', {
      name: 'Lab',
      type: 'room',
    });
    const cab = await req<{ code: string }>('POST', '/api/locations', {
      name: 'Cab',
      type: 'cabinet',
      parent: lab.code,
    });
    const boundary = '----ixf';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><rect id="loc:${cab.code}"/><script>alert(1)</script></svg>`;
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="lab.svg"',
      'Content-Type: image/svg+xml',
      '',
      svg,
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const file = (
      await env.app.inject({
        method: 'POST',
        url: '/api/files',
        payload: body,
        headers: {
          authorization: `Bearer ${env.adminToken}`,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
      })
    ).json<{ id: string; href: string }>();
    expect(await req('PUT', `/api/locations/${lab.code}/map`, { fileId: file.id })).toMatchObject({
      links: [{ code: cab.code }],
    });
    expect(await req('GET', `/api/locations/${lab.code}/map/check`)).toMatchObject({ unknown: [] });
    expect(
      await req('PUT', `/api/locations/${lab.code}/map/links`, {
        elementKey: `loc:${cab.code}`,
        target: null,
      }),
    ).toMatchObject({ links: [{ auto: true }] });
    const copies = await req<{ code: string; name: string }[]>(
      'POST',
      `/api/locations/${cab.code}/duplicate`,
      { count: 2 },
    );
    expect(copies.map((c) => c.name)).toEqual(['Cab 2', 'Cab 3']);
    const library = await req<{ usages: unknown[] }[]>('GET', '/api/map-drawings');
    expect(library).toEqual([expect.objectContaining({ usages: [expect.anything()] })]);
    const layers = await req<{ href: string; highlight: string[] }[]>(
      'GET',
      `/api/maps/${cab.code}`,
    );
    expect(layers).toEqual([expect.objectContaining({ highlight: [cab.code] })]);
    const served = await env.app.inject({ url: layers[0]!.href });
    expect(served.headers['content-security-policy']).toContain('sandbox');
    const removed = await env.app.inject({
      method: 'DELETE',
      url: `/api/locations/${lab.code}/map`,
      headers: { authorization: `Bearer ${env.adminToken}` },
    });
    expect(removed.statusCode).toBe(204);
  });
});

describe('users, setup and backups over HTTP', () => {
  it('lets admins manage users and tokens, and people change their own password', async () => {
    await req('POST', '/api/users', { name: 'pat', role: 'member', password: 'first password' });
    const created = await req<{ token: string; id: string }>('POST', '/api/users/pat/tokens', {
      name: 'claude',
      scopes: ['inventory'],
    });
    expect(created.token).toMatch(/^ixf_/);
    const list = await req<{ name: string; hasPassword: boolean; tokens: { name: string }[] }[]>(
      'GET',
      '/api/users',
    );
    expect(list.find((u) => u.name === 'pat')).toMatchObject({
      hasPassword: true,
      tokens: [{ name: 'claude' }],
    });
    await req('PATCH', '/api/users/pat', { role: 'viewer' });
    const forbidden = await env.app.inject({
      url: '/api/users',
      headers: { authorization: `Bearer ${created.token}` },
    });
    expect(forbidden.statusCode).toBe(403);
    await req('DELETE', `/api/tokens/${created.id}`);
    expect(
      (
        await env.app.inject({
          url: '/api/session',
          headers: { authorization: `Bearer ${created.token}` },
        })
      ).statusCode,
    ).toBe(401);

    const login = (
      await env.app.inject({
        method: 'POST',
        url: '/api/session',
        payload: { name: 'pat', password: 'first password' },
      })
    ).json<{ token: string }>();
    const wrong = await env.app.inject({
      method: 'POST',
      url: '/api/session/password',
      payload: { current: 'nope', next: 'second password' },
      headers: { authorization: `Bearer ${login.token}` },
    });
    expect(wrong.statusCode).toBe(403);
    const ok = await env.app.inject({
      method: 'POST',
      url: '/api/session/password',
      payload: { current: 'first password', next: 'second password' },
      headers: { authorization: `Bearer ${login.token}` },
    });
    expect(ok.statusCode).toBe(204);
  });

  it('reports setup state, lists history and downloads backups for admins', async () => {
    expect(await req('GET', '/api/setup')).toMatchObject({ secure: false, certificate: false });
    expect((await env.app.inject({ url: '/api/setup/root.crt' })).statusCode).toBe(404);
    await req('POST', '/api/locations', { name: 'Lab', type: 'room' });
    expect((await req<unknown[]>('GET', '/api/history')).length).toBeGreaterThan(0);
    expect((await req<unknown[]>('GET', '/api/carry/all')).length).toBe(0);
    const { file } = await req<{ file: string }>('POST', '/api/backups');
    const list = await req<{ name: string; size: number }[]>('GET', '/api/backups');
    expect(file.endsWith(list[0]!.name)).toBe(true);
    const dl = await env.app.inject({
      url: `/api/backups/${list[0]!.name}`,
      headers: { authorization: `Bearer ${env.adminToken}` },
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.rawPayload.subarray(0, 15).toString()).toBe('SQLite format 3');
    expect(
      (
        await env.app.inject({
          url: '/api/backups/../../etc/passwd',
          headers: { authorization: `Bearer ${env.adminToken}` },
        })
      ).statusCode,
    ).not.toBe(200);
  });
});

describe('label management over HTTP', () => {
  it('lists batches, downloads unused codes, retires, changes and swaps codes', async () => {
    await env.app.inject({
      method: 'POST',
      url: '/api/labels/blank',
      payload: { count: 2 },
      headers: { authorization: `Bearer ${env.adminToken}` },
    });
    const [batch] = await req<{ id: string; unused: string[] }[]>('GET', '/api/labels/batches');
    // Unused codes are for people who may stick them on, not for anyone on the LAN.
    expect((await env.app.inject({ url: '/api/labels/batches' })).statusCode).toBe(401);
    const csvUrl = `/api/labels/batches/${batch!.id}/labels.csv`;
    expect((await env.app.inject({ url: csvUrl })).statusCode).toBe(401);
    const csv = await env.app.inject({
      url: csvUrl,
      headers: { authorization: `Bearer ${env.adminToken}` },
    });
    expect(csv.body.split('\r\n').filter(Boolean)).toHaveLength(3);
    expect(await req('POST', '/api/labels/retire', { codes: [batch!.unused[0]] })).toEqual({
      retired: 1,
    });
    const a = await req<{ code: string }>('POST', '/api/locations', { name: 'A' });
    const b = await req<{ code: string }>('POST', '/api/locations', { name: 'B' });
    const changed = await req<{ code: string }>('POST', `/api/locations/${a.code}/code`, {
      code: batch!.unused[1],
    });
    expect(changed.code).toBe(batch!.unused[1]);
    await req('POST', `/api/locations/${changed.code}/swap-code`, { with: b.code });
    expect((await req<{ name: string }>('GET', `/api/locations/${changed.code}`)).name).toBe('B');
    expect(await req('GET', `/api/codes/${a.code}`)).toMatchObject({
      retired: { note: 'was place A' },
    });
  });
});
