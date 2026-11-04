import type { LotView, PartDetail } from '@ixfwms/domain';
import { expect, post, test, unique } from './fixtures.js';

interface Place {
  code: string;
  name: string;
}

test.describe('everyday flows on a phone', () => {
  test('search, open, take', async ({ page, api, signedIn: _ }) => {
    const shelf = await post<Place>(api, '/api/locations', {
      name: unique('Shelf'),
      type: 'shelf',
    });
    const name = unique('Suction cup');
    await post(api, '/api/parts', {
      name,
      status: 'active',
      stock: { location: shelf.code, amount: { mode: 'count', quantity: 10 } },
    });

    await page.goto('/items');
    await page.getByLabel('Search items').fill(name);
    await page.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();

    await page.getByRole('button', { name: 'Take', exact: true }).click();
    await page.getByLabel('How many were taken').fill('3');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('7 pcs')).toBeVisible();
  });

  test('search lists a tool by its units, one tap to the one you want', async ({
    page,
    api,
    signedIn: _,
  }) => {
    const shelf = await post<Place>(api, '/api/locations', {
      name: unique('Tool shelf'),
      type: 'shelf',
    });
    const name = unique('Impact drill');
    const drill = await post<Place>(api, '/api/parts', {
      name,
      kind: 'tool',
      tracking: 'individual',
      status: 'active',
    });
    const [first, second] = await post<{ code: string; name: string }[]>(api, '/api/units', {
      part: drill.code,
      location: shelf.code,
      units: [{}, { serialNo: 'SN-2' }],
    });

    await page.goto('/items');
    await page.getByLabel('Search items').fill(name);
    await expect(page.getByRole('link', { name: first!.name })).toBeVisible();
    await page.getByRole('link', { name: second!.name }).click();
    await expect(page).toHaveURL(new RegExp(`/u/${second!.code}$`));
  });

  test('scan, carry, put down', async ({ page, api, signedIn: _ }) => {
    const shelf = await post<Place>(api, '/api/locations', {
      name: unique('Shelf'),
      type: 'shelf',
    });
    const box = await post<Place>(api, '/api/locations', {
      name: unique('Box'),
      type: 'box',
      parent: shelf.code,
    });
    const cell = await post<Place>(api, '/api/locations', {
      name: unique('Robot cell'),
      type: 'zone',
    });

    // Pick up: scan (type) the box's code.
    await page.goto('/scan?mode=pick');
    await page.getByLabel('Code or link').fill(box.code);
    await page.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByText(`Picked up ${box.name}`)).toBeVisible();

    // Put down: scan where it goes.
    await page.goto('/scan?mode=drop');
    await page.getByLabel('Code or link').fill(cell.code);
    await page.getByRole('button', { name: 'Open' }).click();
    await page.getByRole('button', { name: 'Put 1 thing here' }).click();
    await expect(page).toHaveURL(new RegExp(`/l/${cell.code}$`));
    await expect(page.getByRole('link', { name: new RegExp(box.name) })).toBeVisible();
  });

  test('anyone can clear a bench, and stock goes back to its own shelf', async ({ page, api }) => {
    const shelf3 = await post<Place>(api, '/api/locations', {
      name: unique('Shelf 3'),
      type: 'shelf',
    });
    const shelf5 = await post<Place>(api, '/api/locations', {
      name: unique('Shelf 5'),
      type: 'shelf',
    });
    const bench = await post<Place>(api, '/api/locations', {
      name: unique('Workbench'),
      type: 'workstation',
    });
    const screw = await post<PartDetail>(api, '/api/parts', {
      name: unique('M3x10'),
      status: 'active',
      stock: { location: shelf3.code, amount: { mode: 'count', quantity: 50 } },
    });
    const other = await post<LotView>(api, '/api/stock', {
      part: screw.code,
      location: shelf5.code,
      amount: { mode: 'count', quantity: 30 },
    });
    await post(api, `/api/stock/${screw.lots[0]!.id}/move`, { to: bench.code, quantity: 10 });
    await post(api, `/api/stock/${other.id}/move`, { to: bench.code, quantity: 4 });

    // Not logged in.
    await page.goto(`/l/${bench.code}`);
    await page.getByRole('button', { name: 'Clear the bench' }).click();
    await page.getByLabel('Your name').fill('Pekka');
    await page.getByRole('button', { name: 'Clear the bench' }).click();
    await expect(page.getByText('Put back 2 things:')).toBeVisible();

    const after = (await (await api.get(`/api/parts/${screw.code}`)).json()) as PartDetail;
    expect(after.lots.map((l) => [l.location.code, l.amount.quantity]).sort()).toEqual(
      [
        [shelf3.code, 50],
        [shelf5.code, 30],
      ].sort(),
    );
  });
});
