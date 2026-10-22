import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

const base = { identifiers: [], tags: [], attributes: {}, status: 'draft' as const };

describe('merging duplicate parts', () => {
  it('moves stock, identifiers, tags and files, then deletes the duplicate', async () => {
    const { parts, files } = env.services;
    const box = await env.services.locations.create({ name: 'Box', type: 'box' }, env.admin);
    const keep = await parts.create(
      {
        ...base,
        name: 'VN-10 vacuum generator',
        stock: { location: box.code, amount: { mode: 'count', quantity: 2 } },
      },
      env.admin,
    );
    const dup = await parts.create(
      {
        ...base,
        name: 'Festo VN-10',
        manufacturer: 'Festo',
        identifiers: [{ kind: 'order_no', value: 'VN-10-H-T3-PQ2-VQ3-RO1' }],
        tags: ['Gripper v2'],
        stock: { location: box.code, amount: { mode: 'count', quantity: 3 } },
      },
      env.inventory,
    );
    await files.attach(
      { owner: 'part', ref: dup.code, kind: 'product_page', url: 'https://example.com/vn10' },
      env.admin,
    );

    await expect(parts.mergeInto(dup.code, keep.code, env.inventory)).rejects.toThrow(/write/);
    const merged = await parts.mergeInto(dup.code, keep.code, env.admin);

    expect(merged.manufacturer).toBe('Festo');
    expect(merged.identifiers.map((i) => i.value)).toEqual(['VN-10-H-T3-PQ2-VQ3-RO1']);
    expect(merged.tags).toEqual(['Gripper v2']);
    expect(merged.lots).toHaveLength(1);
    expect(merged.lots[0]?.amount.quantity).toBe(5);
    expect(merged.attachments).toHaveLength(1);
    await expect(parts.get(dup.code)).rejects.toThrow(/not found/);
  });
});

describe('web login', () => {
  it('logs in with a password and ends the session on logout', async () => {
    await env.services.auth.setPassword('assistant', 'correct horse');
    const bad = await env.app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { name: 'assistant', password: 'nope' },
    });
    expect(bad.statusCode).toBe(401);
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { name: 'assistant', password: 'correct horse' },
    });
    expect(res.statusCode).toBe(201);
    const { token, user } = res.json<{ token: string; user: { scopes: string[] } }>();
    expect(user.scopes).toEqual(['write']);
    const headers = { authorization: `Bearer ${token}` };
    expect((await env.app.inject({ url: '/api/session', headers })).json()).toMatchObject({
      name: 'assistant',
      role: 'member',
    });
    expect(
      (await env.app.inject({ method: 'DELETE', url: '/api/session', headers })).statusCode,
    ).toBe(204);
    expect((await env.app.inject({ url: '/api/session', headers })).statusCode).toBe(401);
  });

  it('rejects short passwords and locks out after repeated failures', async () => {
    await expect(env.services.auth.setPassword('assistant', 'short')).rejects.toThrow(/at least/);
    await env.services.auth.setPassword('assistant', 'correct horse');
    for (let i = 0; i < 10; i++)
      await env.services.auth.login('assistant', 'wrong').catch(() => {});
    await expect(env.services.auth.login('assistant', 'correct horse')).rejects.toThrow(/Too many/);
  });
});
