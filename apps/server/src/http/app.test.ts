import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../test/harness.js';

let env: TestEnv;
afterEach(async () => env.cleanup());

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('HTTP API', () => {
  beforeEach(async () => {
    env = await createTestEnv();
  });

  it('allows anonymous reads but needs a token to write', async () => {
    expect((await env.app.inject({ url: '/api/locations' })).statusCode).toBe(200);
    const anon = await env.app.inject({
      method: 'POST',
      url: '/api/locations',
      payload: { name: 'x' },
    });
    expect(anon.statusCode).toBe(401);
    const bad = await env.app.inject({
      method: 'POST',
      url: '/api/locations',
      payload: { name: 'x' },
      headers: auth('ixf_nope'),
    });
    expect(bad.statusCode).toBe(401);
    const ok = await env.app.inject({
      method: 'POST',
      url: '/api/locations',
      payload: { name: 'Lab', type: 'room' },
      headers: auth(env.inventoryToken),
    });
    expect(ok.statusCode).toBe(201);
  });

  it('takes changes without a login only on the routes meant for guests', async () => {
    // Every route that changes something, from Fastify's route tree.
    const changes: string[] = [];
    const stack: string[] = [];
    for (const line of env.app.printRoutes({ commonPrefix: false }).split('\n')) {
      const at = line.search(/[├└]── /);
      if (at < 0) continue;
      const [, segment, methods] = /^(\S+)(?: \(([A-Z, ]+)\))?/.exec(line.slice(at + 4))!;
      const depth = at / 4;
      stack.length = depth;
      stack.push((stack[depth - 1] ?? '') + segment);
      for (const method of methods?.split(', ') ?? [])
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method))
          changes.push(`${method} ${stack[depth]}`);
    }
    expect(changes.length).toBeGreaterThan(80);
    const open: string[] = [];
    for (const route of changes) {
      const [method, path] = route.split(' ') as ['POST', string];
      const res = await env.app.inject({ method, url: path.replace(/:[^/]+/g, 'x'), payload: {} });
      if (res.statusCode !== 401) open.push(route);
    }
    // Adding to this list lets people without an account do something new: on purpose only.
    expect(open.sort()).toEqual([
      'DELETE /api/session',
      'POST /api/bom/check',
      'POST /api/locations/:ref/clear',
      'POST /api/parts/similar',
      'POST /api/reports',
      'POST /api/session',
      'POST /api/stock/:lotId/open-move',
      'POST /api/stock/:lotId/put-back',
      'POST /api/units/:ref/found',
      'POST /api/units/:ref/move',
      'POST /api/units/:ref/put-back',
    ]);
  });

  it('returns 400 with details for invalid input and 404 for unknown refs', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/parts',
      payload: { name: '' },
      headers: auth(env.adminToken),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid', key: 'input.invalid' });
    const missing = await env.app.inject({ url: '/api/parts/ZZZZ' });
    expect(missing.statusCode).toBe(404);
    // The web app translates by key; scripts and MCP read the English message.
    expect(missing.json()).toEqual({
      error: 'not_found',
      message: 'Part not found: ZZZZ',
      key: 'notFound.part',
      params: { ref: 'ZZZZ' },
    });
  });

  it('builds QR URLs from the request host when no public URL is configured', async () => {
    const loc = (
      await env.app.inject({
        method: 'POST',
        url: '/api/locations',
        payload: { name: 'Box' },
        headers: auth(env.adminToken),
      })
    ).json<{ code: string }>();
    const label = await env.app.inject({
      url: `/api/locations/${loc.code}/label`,
      headers: { host: 'ixf.local' },
    });
    expect(label.json()).toMatchObject({ qr: `HTTP://IXF.LOCAL/L/${loc.code}` });
    const page = await env.app.inject({ url: `/L/${loc.code}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Box');
    expect((await env.app.inject({ url: '/l/ZZZZ' })).statusCode).toBe(404);
  });

  it('uploads, deduplicates and serves files', async () => {
    const boundary = '----ixf';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="note.txt"',
      'Content-Type: text/plain',
      '',
      'hello lab',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const upload = () =>
      env.app.inject({
        method: 'POST',
        url: '/api/files',
        payload: body,
        headers: {
          ...auth(env.inventoryToken),
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
      });
    const first = (await upload()).json<{ id: string; href: string; size: number }>();
    const second = (await upload()).json<{ id: string }>();
    expect(second.id).toBe(first.id);
    expect(first.size).toBe(9);
    const download = await env.app.inject({ url: first.href });
    expect(download.body).toBe('hello lab');
    expect(download.headers['content-type']).toContain('text/plain');
  });

  it('exports everything as JSON for admins', async () => {
    const res = await env.app.inject({ url: '/api/export', headers: auth(env.adminToken) });
    expect(res.json()).toMatchObject({ format: 'ixfwms-export', version: 1 });
    // The Inbox and "Out of the lab".
    expect(res.json<{ locations: unknown[] }>().locations).toHaveLength(2);
  });
});

describe('configured public URL', () => {
  beforeEach(async () => {
    env = await createTestEnv({ IXF_PUBLIC_URL: 'https://ixf.internal/' });
  });

  it('wins over the request host', async () => {
    const info = await env.app.inject({ url: '/api/info', headers: { host: '10.0.0.5:3000' } });
    expect(info.json()).toMatchObject({
      baseUrl: 'https://ixf.internal',
      mcpUrl: 'https://ixf.internal/mcp',
    });
  });
});

describe('serving the web app', () => {
  let webDir: string;
  beforeEach(async () => {
    webDir = await mkdtemp(join(tmpdir(), 'ixfwms-web-'));
    await mkdir(join(webDir, 'assets'));
    await writeFile(join(webDir, 'index.html'), '<!doctype html><title>ixfwms app</title>');
    await writeFile(join(webDir, 'assets', 'app-123.js'), 'console.log(1)');
    env = await createTestEnv({ IXF_WEB_DIR: webDir });
  });
  afterEach(async () => rm(webDir, { recursive: true, force: true }));

  it('serves index.html for app routes, assets with long caching, and keeps API 404s as JSON', async () => {
    for (const url of ['/', '/L/A3F9', '/p/K7Q2/edit', '/inbox']) {
      const res = await env.app.inject({ url });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('ixfwms app');
      expect(res.headers['content-security-policy'], url).toMatch(
        /script-src 'self';.*frame-ancestors 'none'/,
      );
    }
    const asset = await env.app.inject({ url: '/assets/app-123.js' });
    expect(asset.headers['cache-control']).toContain('immutable');
    // Built after the server started (e.g. a rebuild): still served, and missing assets are 404s.
    await writeFile(join(webDir, 'assets', 'app-456.js'), 'console.log(2)');
    expect((await env.app.inject({ url: '/assets/app-456.js' })).body).toBe('console.log(2)');
    expect((await env.app.inject({ url: '/assets/gone-789.js' })).statusCode).toBe(404);
    expect((await env.app.inject({ url: '/../package.json' })).body).toContain('ixfwms app');
    const api = await env.app.inject({ url: '/api/nope' });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toMatchObject({ error: 'not_found' });
  });
});
