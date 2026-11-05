import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

describe('turning users off and removing them', () => {
  it('turns a user off (no login, tokens revoked, history kept) and back on', async () => {
    const { auth, locations } = env.services;
    await auth.createUser('pekka', 'member');
    await auth.setPassword('pekka', 'long enough');
    const { token } = await auth.createToken('pekka', 'script', ['inventory']);
    const pekka = (await auth.verify(token))!;
    await locations.create({ name: 'Shelf', type: 'shelf' }, pekka);

    const detail = await auth.userDetail('pekka');
    expect(detail).toMatchObject({ active: true, canDelete: false });
    expect(detail.history).toBeGreaterThan(0);
    await expect(auth.deleteUser('pekka', env.admin)).rejects.toThrow(/turn the account off/);

    await auth.deactivate('pekka', env.admin);
    expect(await auth.verify(token)).toBeNull();
    await expect(auth.login('pekka', 'long enough')).rejects.toThrow(/turned off/);
    await expect(auth.createToken('pekka', 'again', ['read'])).rejects.toThrow(/turned off/);
    const history = await env.services.history.recent();
    expect(history.find((h) => h.action === 'create')?.user).toBe('pekka');

    await auth.reactivate('pekka');
    expect((await auth.login('pekka', 'long enough')).user.name).toBe('pekka');
  });

  it("won't turn off yourself, the last admin, or someone with a loan or carrying things", async () => {
    const { auth, carry, locations } = env.services;
    await expect(auth.deactivate('admin', env.admin)).rejects.toThrow(/your own/);
    await expect(auth.deactivate('admin', env.inventory)).rejects.toThrow(/last admin/);
    const box = await locations.create({ name: 'Box', type: 'box' }, env.admin);
    await carry.pick({ location: box.code }, env.inventory);
    await expect(auth.deactivate('assistant', env.admin)).rejects.toThrow(/carrying 1/);
    expect((await auth.userDetail('assistant')).carrying).toBe(1);
  });

  it('removes a user with no history for good', async () => {
    const { auth } = env.services;
    await auth.createUser('typo', 'viewer');
    await auth.createToken('typo', 'oops', ['read']);
    expect((await auth.userDetail('typo')).canDelete).toBe(true);
    const res = await env.app.inject({
      method: 'DELETE',
      url: '/api/users/typo',
      headers: { authorization: `Bearer ${env.adminToken}` },
    });
    expect(res.statusCode).toBe(204);
    expect((await auth.listUsers()).map((u) => u.name)).not.toContain('typo');
  });
});

describe('your own account over HTTP', () => {
  const login = async (name: string, role: 'viewer' | 'member' | 'admin') => {
    await env.services.auth.createUser(name, role);
    await env.services.auth.setPassword(name, 'long enough');
    const res = await env.services.auth.login(name, 'long enough');
    return { authorization: `Bearer ${res.token}` };
  };
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    headers?: Record<string, string>,
    payload?: object,
  ) => env.app.inject({ method, url, headers, payload });

  it('members make and delete their own tokens, within what they may do', async () => {
    const pat = await login('pat', 'member');
    const made = await call('POST', '/api/session/tokens', pat, {
      name: 'script',
      scopes: ['inventory'],
    });
    expect(made.statusCode).toBe(201);
    const { id, token } = made.json<{ id: string; token: string }>();
    const mine = await call('GET', '/api/session/tokens', pat);
    expect(mine.json<{ id: string }[]>().map((t) => t.id)).toContain(id);

    const tooMuch = await call('POST', '/api/session/tokens', pat, {
      name: 'x',
      scopes: ['admin'],
    });
    expect(tooMuch.statusCode).toBe(403);

    // A token can't make or remove tokens: a leaked one could otherwise outlive being revoked.
    const byToken = { authorization: `Bearer ${token}` };
    expect((await call('GET', '/api/session/tokens', byToken)).statusCode).toBe(403);
    expect((await call('DELETE', `/api/session/tokens/${id}`, byToken)).statusCode).toBe(403);

    expect((await call('DELETE', `/api/session/tokens/${id}`, pat)).statusCode).toBe(204);
    expect(await env.services.auth.verify(token)).toBeNull();
  });

  it("leaves other people's tokens alone, and viewers and anonymous readers without any", async () => {
    const pat = await login('pat', 'member');
    const sam = await login('sam', 'member');
    const made = await call('POST', '/api/session/tokens', pat, {
      name: 'script',
      scopes: ['read'],
    });
    const { id, token } = made.json<{ id: string; token: string }>();
    expect((await call('DELETE', `/api/session/tokens/${id}`, sam)).statusCode).toBe(404);
    expect(await env.services.auth.verify(token)).not.toBeNull();

    const viewer = await login('vera', 'viewer');
    expect((await call('GET', '/api/session/tokens', viewer)).statusCode).toBe(403);
    expect((await call('GET', '/api/session/tokens')).statusCode).toBe(401);
    expect((await call('GET', '/api/users', pat)).statusCode).toBe(403);
  });

  it('settings: your own, and an admin can change anyone’s', async () => {
    const pat = await login('pat', 'member');
    const room = await env.services.locations.create({ name: 'Lab', type: 'room' }, env.admin);
    expect((await call('PATCH', '/api/session', pat, { language: 'fi' })).json()).toMatchObject({
      language: 'fi',
      home: null,
    });
    const admin = { authorization: `Bearer ${env.adminToken}` };
    await call('PATCH', '/api/users/pat', admin, { home: room.code, language: 'en' });
    expect((await call('GET', '/api/session', pat)).json()).toMatchObject({
      language: 'en',
      home: { code: room.code },
    });
    expect((await call('GET', '/api/users/pat', admin)).json()).toMatchObject({ language: 'en' });
    expect((await call('PATCH', '/api/users/pat', pat, { language: 'fi' })).statusCode).toBe(403);
    await call('PATCH', '/api/users/pat', admin, { home: null });
    expect((await call('GET', '/api/session', pat)).json()).toMatchObject({ home: null });
    expect(
      (await call('PATCH', '/api/session', pat, { language: 'sv' })).statusCode,
    ).toBeGreaterThanOrEqual(400);
  });
});

describe('when someone’s access changes', () => {
  const session = async (name: string) =>
    (await env.services.auth.login(name, 'long enough')).token;

  it('a new password logs out the old one’s browsers, but not the one changing it', async () => {
    const { auth } = env.services;
    await auth.createUser('pat', 'member');
    await auth.setPassword('pat', 'long enough');
    const laptop = await session('pat');
    const phone = await session('pat');
    const { token: script } = await auth.createToken('pat', 'script', ['inventory']);

    const pat = (await auth.verify(laptop))!;
    await auth.changeOwnPassword(pat.userId, 'long enough', 'even longer', laptop);
    expect(await auth.verify(laptop)).not.toBeNull();
    expect(await auth.verify(phone)).toBeNull();
    expect(await auth.verify(script)).not.toBeNull();

    // An admin resetting it logs out every browser.
    await auth.setPassword('pat', 'reset by admin');
    expect(await auth.verify(laptop)).toBeNull();
  });

  it('a new role takes effect at once, for web sessions and API tokens alike', async () => {
    const { auth } = env.services;
    await auth.createUser('ada', 'admin');
    await auth.setPassword('ada', 'long enough');
    const web = await session('ada');
    const { token: api } = await auth.createToken('ada', 'script', ['admin']);

    await auth.setRole('ada', 'viewer');
    expect((await auth.verify(web))!.scopes).toEqual(['read']);
    expect((await auth.verify(api))!.scopes).toEqual(['read']);
    await auth.setRole('ada', 'member');
    expect((await auth.verify(web))!.scopes).toEqual(['write']);
    expect((await auth.verify(api))!.scopes).toEqual(['write']);
    await expect(auth.createToken('ada', 'more', ['admin'])).rejects.toThrow(/member can't/);
  });

  it('keeps one admin: the last one can’t be made something else', async () => {
    const { auth } = env.services;
    await expect(auth.setRole('admin', 'member')).rejects.toThrow(/last admin/);
    await auth.createUser('ada', 'admin');
    await auth.setRole('admin', 'member');
    expect((await auth.verify(env.adminToken))!.scopes).toEqual(['write']);
  });

  it('times a login the same whether or not the name exists', async () => {
    const { auth } = env.services;
    await auth.createUser('pat', 'member');
    await auth.setPassword('pat', 'long enough');
    const time = async (name: string) => {
      const start = performance.now();
      await auth.login(name, 'wrong password').catch(() => {});
      return performance.now() - start;
    };
    await time('nobody'); // makes the stand-in hash
    const known = await time('pat');
    const unknown = await time('nobody');
    expect(unknown).toBeGreaterThan(known / 3);
  });
});

describe('who may change what guests can do', () => {
  it('is for admins only, while members change other lab settings', async () => {
    const { settings, auth } = env.services;
    const member = (await auth.verify(
      (await auth.createToken('assistant', 'w', ['write'])).token,
    ))!;
    await expect(settings.update({ anonymousView: 'full' }, member)).rejects.toThrow(/admin/);
    await expect(settings.update({ anonymousActions: 'put_back' }, member)).rejects.toThrow(
      /admin/,
    );
    await settings.update({ labelTape: '24' }, member);
    await settings.update({ anonymousView: 'full' }, env.admin);
    expect(await settings.get()).toMatchObject({ labelTape: '24', anonymousView: 'full' });
  });
});
