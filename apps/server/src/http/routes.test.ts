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
  method: 'GET' | 'POST' | 'PATCH',
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
  return res.json<T>();
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
      { path: 'Pneumatics', parts: 0 },
      { path: 'Pneumatics/Vacuum', parts: 1 },
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
