import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

const admin = () => ({ authorization: `Bearer ${env.adminToken}` });

/** Ulla with a bit of everything: an item she added, a loan and a return, a report, a carry place. */
async function ulla() {
  const { auth, locations, parts, units, reports, carry } = env.services;
  await auth.createUser('Ulla', 'member');
  await auth.setPassword('Ulla', 'long enough');
  const { token } = await auth.createToken('Ulla', 'script', ['write']);
  const actor = (await auth.verify(token))!;
  const shelf = await locations.create({ name: 'Shelf', type: 'shelf' }, env.admin);
  const box = await locations.create({ name: 'Box', type: 'box' }, actor);
  const drill = await parts.create({ name: 'Impact drill', kind: 'tool', status: 'active' }, actor);
  const [unit] = await units.add({ part: drill.code, units: [{ name: 'Drill 2' }] }, actor);
  await env.services.loans.lendUnit(
    unit!.code,
    { responsible: 'Ulla', description: 'Thesis tests' },
    env.admin,
  );
  await env.services.loans.returnUnit(unit!.code, shelf.code, actor);
  await reports.create({ owner: 'unit', ref: unit!.code, kind: 'broken', note: 'Slips' }, actor);
  await carry.pick({ location: box.code }, actor);
  await carry.drop(shelf.code, null, actor);
  return { token, unit: unit! };
}

describe('erasing a person', () => {
  it('keeps the history under "Removed user" and leaves no trace of the name', async () => {
    const { auth, history, units } = env.services;
    const { token, unit } = await ulla();
    expect((await auth.userDetail('Ulla')).canDelete).toBe(false);
    expect(JSON.stringify(await env.services.export.exportAll())).toMatch(/Ulla/);

    const res = await env.app.inject({
      method: 'POST',
      url: '/api/users/Ulla/erase',
      headers: admin(),
    });
    expect(res.statusCode).toBe(204);

    expect(JSON.stringify(await env.services.export.exportAll())).not.toMatch(/Ulla/);
    expect(await auth.verify(token)).toBeNull();
    await expect(auth.login('Ulla', 'long enough')).rejects.toThrow();
    await expect(auth.userDetail('Ulla')).rejects.toThrow(/No user|not found/i);
    const names = (await auth.listUsersWithTokens()).map((u) => u.name);
    expect(names).not.toContain('Ulla');
    expect(names).not.toContain('Removed user');

    const recent = await history.recent();
    expect(recent.some((h) => h.user === 'Removed user')).toBe(true);
    const detail = await units.detail(unit.code, env.admin);
    expect(detail.loans[0]).toMatchObject({
      responsible: 'Removed user',
      returnedBy: 'Removed user',
      description: 'Thesis tests',
    });
    expect(detail.reports[0]?.by).toBe('Removed user');
  });

  it('hands every erased person to the same "Removed user", which nobody can use', async () => {
    const { auth } = env.services;
    await ulla();
    await auth.createUser('Pekka', 'member');
    const { token } = await auth.createToken('Pekka', 'script', ['inventory']);
    await env.services.locations.create({ name: 'Bench', type: 'shelf' }, await auth.verify(token));
    await auth.erase('Ulla', env.admin);
    await auth.erase('Pekka', env.admin);
    expect((await auth.listUsers()).filter((u) => u.name === 'Removed user')).toHaveLength(1);
    await expect(auth.createUser('removed user')).rejects.toThrow(/already exists/);
    await expect(auth.setPassword('Removed user', 'long enough')).rejects.toThrow();
    await expect(auth.erase('Removed user', env.admin)).rejects.toThrow();
    await expect(auth.createToken('Removed user', 'x', ['read'])).rejects.toThrow();
  });

  it('has the same rules as turning off, and is for admins only', async () => {
    const { auth, carry, locations, parts, units } = env.services;
    await expect(auth.erase('admin', env.admin)).rejects.toThrow(/your own/);
    await expect(auth.erase('admin', env.inventory)).rejects.toThrow(/last admin/);

    const box = await locations.create({ name: 'Box', type: 'box' }, env.admin);
    await carry.pick({ location: box.code }, env.inventory);
    await expect(auth.erase('assistant', env.admin)).rejects.toThrow(/carrying 1/);

    await auth.createUser('Ulla', 'member');
    const drill = await parts.create({ name: 'Drill', kind: 'tool', status: 'active' }, env.admin);
    const [unit] = await units.add({ part: drill.code, units: [{ name: 'D' }] }, env.admin);
    await env.services.loans.lendUnit(
      unit!.code,
      { responsible: 'Ulla', description: 'Fair' },
      env.admin,
    );
    await expect(auth.erase('Ulla', env.admin)).rejects.toThrow(/loan/);

    const asInventory = await env.app.inject({
      method: 'POST',
      url: '/api/users/Ulla/erase',
      headers: { authorization: `Bearer ${env.inventoryToken}` },
    });
    expect(asInventory.statusCode).toBe(403);
    expect(
      (await env.app.inject({ method: 'POST', url: '/api/users/Ulla/erase' })).statusCode,
    ).toBe(401);
  });
});
