import { DEFAULT_STOCK_LEVELS } from '@ixfwms/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestEnv, type TestEnv } from '../test/harness.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => {
  vi.useRealTimers();
  await env.cleanup();
});

const DAY = 86_400_000;
/** Moves the clock (Date only, so database calls keep working). */
const later = (days: number) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + days * DAY);
};

describe('temporary places', () => {
  it('flags pallets left untouched too long, and any activity restarts the clock', async () => {
    const { locations, stock, parts, maps, files } = env.services;
    const hall = await locations.create({ name: 'Hall', type: 'room' }, env.admin);
    const zone = await locations.create(
      { name: 'Floor 1', type: 'zone', parent: hall.code },
      env.admin,
    );
    const pallet = await locations.create(
      { name: 'Delivery from Festo', type: 'pallet', parent: zone.code, contact: 'Pat' },
      env.admin,
    );
    const box = await locations.create(
      { name: 'Fittings', type: 'box', parent: pallet.code },
      env.admin,
    );
    const shelf = await locations.create(
      { name: 'Shelf', type: 'shelf', parent: hall.code },
      env.admin,
    );
    expect(pallet).toMatchObject({ stayDays: 14, overdue: false });
    expect(shelf.stayDays).toBeNull();

    // The hall map shows the zone; it should turn amber when the pallet on it is overdue.
    const svg = await files.store(
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><rect id="loc-${zone.code}"/></svg>`),
      { filename: 'hall.svg', mime: 'image/svg+xml' },
      env.admin,
    );
    await maps.setMap(hall.code, svg.id, env.admin);

    later(15);
    expect(await locations.overdue()).toEqual([
      expect.objectContaining({
        place: expect.objectContaining({ code: pallet.code, overdue: true }),
        contact: 'Pat',
      }),
    ]);
    expect((await maps.layers(hall.code))[0]!.attention).toEqual([zone.code]);

    // Taking something out of a box on the pallet is activity on the pallet.
    const part = await parts.create(
      { name: 'Fitting', identifiers: [], tags: [], attributes: {}, status: 'active' },
      env.admin,
    );
    const lot = await stock.add(
      { part: part.code, location: box.code, amount: { mode: 'count', quantity: 5 } },
      env.admin,
    );
    expect(await locations.overdue()).toEqual([]);

    later(15);
    expect((await locations.overdue()).map((o) => o.place.code)).toEqual([pallet.code]);
    await locations.stillNeeded(pallet.code, env.inventory);
    expect(await locations.overdue()).toEqual([]);

    // A place can say for itself: not temporary, or a stay of its own.
    later(15);
    await locations.update(pallet.code, { stayDays: 0 }, env.admin);
    expect(await locations.overdue()).toEqual([]);
    const shelfNow = await locations.update(shelf.code, { stayDays: 3 }, env.admin);
    expect(shelfNow).toMatchObject({ stayDays: 3, overdue: true });
    void lot;
  });

  it('keeps per-type stays editable', async () => {
    const { placeTypes } = env.services;
    const cart = await placeTypes.createType(
      { name: 'Loan cart', movable: true, stayDays: 7 },
      env.admin,
    );
    expect(cart.stayDays).toBe(7);
    expect(
      (await placeTypes.updateType('loan_cart', { stayDays: null }, env.admin)).stayDays,
    ).toBeNull();
  });
});

describe('lab settings', () => {
  it('starts from defaults and stores changes', async () => {
    const { settings } = env.services;
    expect(await settings.get()).toEqual({
      carryForgottenHours: 4,
      labelTape: '12',
      anonymousActions: 'workstation',
      stockLevels: DEFAULT_STOCK_LEVELS,
    });
    expect(await settings.update({ labelTape: '24' }, env.admin)).toMatchObject({
      labelTape: '24',
    });
    // Changing one setting leaves the others as they were (not back to their defaults).
    await settings.update({ carryForgottenHours: 8 }, env.admin);
    expect(await settings.get()).toMatchObject({ carryForgottenHours: 8, labelTape: '24' });
    await expect(settings.update({ carryForgottenHours: 2 }, env.inventory)).rejects.toThrow();
    await expect(settings.update({ carryForgottenHours: 0 }, env.admin)).rejects.toThrow();
  });

  it('changes one field of a place type without resetting the others', async () => {
    const { placeTypes } = env.services;
    await placeTypes.updateType('pallet', { name: 'EUR pallet' }, env.admin);
    const pallet = (await placeTypes.types()).find((t) => t.key === 'pallet')!;
    expect(pallet).toMatchObject({ name: 'EUR pallet', movable: true, stayDays: 14 });
  });
});

describe('stock levels', () => {
  it("uses the lab's own levels: names, merging, low stock, and no removing levels in use", async () => {
    const { settings, parts, stock, where } = env.services;
    await settings.update(
      {
        stockLevels: [
          { key: 'full', name: 'Full', state: 'ok' },
          { key: 'half', name: 'Half full', state: 'ok' },
          { key: 'low', name: 'Low', state: 'low' },
          { key: 'empty', name: 'Empty', state: 'empty' },
        ],
      },
      env.admin,
    );
    const box = await env.services.locations.create({ name: 'Box', type: 'box' }, env.admin);
    // Levels can be given by name too.
    const tape = await parts.create(
      {
        name: 'Tape',
        status: 'active',
        stock: { location: box.code, amount: { mode: 'level', level: 'Half full' } },
      },
      env.admin,
    );
    expect(tape.lots[0]!.amount.level).toBe('half');
    // Adding to it keeps the better level.
    await stock.add(
      { part: tape.code, location: box.code, amount: { mode: 'level', level: 'low' } },
      env.admin,
    );
    expect((await parts.get(tape.code)).lots[0]!.amount.level).toBe('half');
    await expect(
      stock.add({ part: tape.code, amount: { mode: 'level', level: 'plenty' } }, env.admin),
    ).rejects.toThrow(/Unknown level "plenty"/);
    expect((await where.ask('tape'))[0]!.text).toMatch(/^Tape: half full at /);

    const lowStock = () => parts.search({ lowStock: true, limit: 10, offset: 0 });
    expect((await lowStock()).total).toBe(0);
    await stock.take(tape.lots[0]!.id, null, 'Low', env.admin);
    expect((await lowStock()).total).toBe(1);

    await expect(
      settings.update(
        {
          stockLevels: [
            { key: 'full', name: 'Full', state: 'ok' },
            { key: 'empty', name: 'Empty', state: 'empty' },
          ],
        },
        env.admin,
      ),
    ).rejects.toThrow(/Stock is at Low/);
    await expect(
      settings.update(
        {
          stockLevels: [
            { key: 'a', name: 'Same', state: 'ok' },
            { key: 'b', name: 'same', state: 'empty' },
          ],
        },
        env.admin,
      ),
    ).rejects.toThrow();
  });
});
