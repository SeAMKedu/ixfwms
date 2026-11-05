import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => env.cleanup());

const draft = { identifiers: [], tags: [], attributes: {}, status: 'draft' as const };

describe('one code namespace', () => {
  it('is enforced by the database, not only by the services', async () => {
    const { locations, parts, labels } = env.services;
    const sql = (q: string, args: string[] = []) => env.database.client.execute({ sql: q, args });
    const box = await locations.create({ name: 'Box', type: 'box' }, env.admin);
    const cup = await parts.create({ ...draft, name: 'Suction cup' }, env.admin);

    await expect(
      sql("INSERT INTO parts (id, code, name) VALUES ('x', ?, 'Sneaky')", [box.code]),
    ).rejects.toThrow(/already in use/);
    await expect(
      sql('UPDATE parts SET code = ? WHERE code = ?', [box.code, cup.code]),
    ).rejects.toThrow(/already in use/);

    // Deleting a row retires its code, whoever deletes it.
    await sql('DELETE FROM locations WHERE code = ?', [box.code]);
    expect((await labels.lookup(box.code)).retired?.note).toBe('was place Box');
    await expect(
      sql('UPDATE parts SET code = ? WHERE code = ?', [box.code, cup.code]),
    ).rejects.toThrow(/retired/);
  });

  it('retires the old code when a code is changed, and swaps place codes', async () => {
    const { locations, labels } = env.services;
    const a = await locations.create({ name: 'Cabinet A', type: 'cabinet' }, env.admin);
    const b = await locations.create({ name: 'Cabinet B', type: 'cabinet' }, env.admin);

    await labels.swapCodes(a.code, b.code, env.admin);
    expect((await locations.resolve(a.code)).name).toBe('Cabinet B');
    expect((await locations.resolve(b.code)).name).toBe('Cabinet A');
    expect(await labels.lookup(a.code)).toMatchObject({ assigned: 'location', retired: null });
    expect(await labels.lookup(b.code)).toMatchObject({ assigned: 'location', retired: null });
    // The temporary code used during the swap is forgotten, not left behind or retired.
    const loose = await env.database.client.execute(
      'SELECT count(*) AS n FROM codes WHERE owner_type IS NULL',
    );
    expect(Number(loose.rows[0]?.n)).toBe(0);

    const fresh = await labels.changeCode('location', a.code, null, env.admin);
    expect(await labels.lookup(fresh)).toMatchObject({ assigned: 'location' });
    expect((await labels.lookup(a.code)).retired?.note).toBe('was place Cabinet B');
  });

  it('counts a blank label as used once a place gets its code', async () => {
    const { locations, labels } = env.services;
    const [first, second] = (await labels.blank(2, env.admin, 'http://lab')).map((l) => l.code);
    await locations.create({ name: 'Box', type: 'box', code: first! }, env.admin);
    expect(await labels.lookup(first!)).toMatchObject({ assigned: 'location', reserved: false });
    expect(await labels.lookup(second!)).toMatchObject({ assigned: null, reserved: true });
    const [batch] = await labels.batches(env.admin);
    expect(batch).toMatchObject({ used: 1, retired: 0, unused: [second] });
  });
});
