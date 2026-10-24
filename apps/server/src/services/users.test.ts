import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../test/harness.js';

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
