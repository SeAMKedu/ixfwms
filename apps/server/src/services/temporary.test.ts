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
    const { locations } = env.services;
    const cart = await locations.createType(
      { name: 'Loan cart', movable: true, stayDays: 7 },
      env.admin,
    );
    expect(cart.stayDays).toBe(7);
    expect(
      (await locations.updateType('loan_cart', { stayDays: null }, env.admin)).stayDays,
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
    const { locations } = env.services;
    await locations.updateType('pallet', { name: 'EUR pallet' }, env.admin);
    const pallet = (await locations.types()).find((t) => t.key === 'pallet')!;
    expect(pallet).toMatchObject({ name: 'EUR pallet', movable: true, stayDays: 14 });
  });
});
