import type { CarryState, LocationDetail, PartSummary } from '@ixfwms/domain';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderAt } from '../test/render';
import { CarryPage } from './carry';
import { LocationPage } from './location';
import { NotFoundPage } from './not-found';
import { ScanPage } from './scan';
import { SearchPage } from './search';

const NO_ADDRESS = {
  shortName: null,
  short: '',
  movable: false,
  address: '',
  within: '',
  stayDays: null,
  dueAt: null,
  overdue: false,
  workstation: false,
};

const part = (over: Partial<PartSummary>): PartSummary => ({
  id: over.code ?? 'x',
  code: 'A3F9',
  name: 'Part',
  manufacturer: null,
  status: 'active',
  kind: 'part',
  tracking: 'bulk',
  aliases: [],
  units: [],
  category: null,
  identifiers: [],
  tags: [],
  stock: [],
  ...over,
});

describe('search page', () => {
  it('lists parts with their stock and marks drafts', async () => {
    renderAt('/', [{ path: '/', element: <SearchPage /> }], {
      '/api/parts': {
        total: 2,
        items: [
          part({
            code: 'K7Q2',
            name: 'Bellows suction cup Ø30',
            manufacturer: 'Schmalz',
            stock: [
              {
                display: '14 pcs',
                location: 'Box',
                locationCode: 'A3F9',
                place: {
                  id: 'b',
                  code: 'A3F9',
                  name: 'Box',
                  type: 'box',
                  kind: 'normal',
                  ...NO_ADDRESS,
                },
              },
            ],
          }),
          part({ code: 'P2X1', name: 'Vacuum generator VN-10', status: 'draft' }),
        ],
      },
      '/api/categories': [],
      '/api/tags': [],
    });
    expect((await screen.findAllByText('Bellows suction cup Ø30')).length).toBeGreaterThan(0);
    expect(screen.getByText('2 items')).toBeTruthy();
    expect(screen.getAllByText('14 pcs').length).toBeGreaterThan(0);
    expect(screen.getAllByText('draft').length).toBeGreaterThan(0);
  });
});

describe('scan page', () => {
  it('opens the place for a scanned label link, whatever the host', async () => {
    const { router } = renderAt(
      '/scan',
      [
        { path: '/scan', element: <ScanPage /> },
        { path: '/l/:code', element: <p>place page</p> },
      ],
      {},
    );
    await userEvent.type(
      screen.getByLabelText('Code or link'),
      'HTTPS://OLD-NAME.LOCAL/L/A3F9{enter}',
    );
    expect(router.state.location.pathname).toBe('/l/A3F9');
  });

  it('explains when the input is not a code', async () => {
    renderAt('/scan', [{ path: '/scan', element: <ScanPage /> }], {});
    await userEvent.type(screen.getByLabelText('Code or link'), 'hello world!{enter}');
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('location page', () => {
  it('shows the path, sub-places and contents', async () => {
    const detail: LocationDetail = {
      id: 'b',
      code: 'A3F9',
      name: 'Box: vacuum parts',
      type: 'box',
      kind: 'normal',
      ...NO_ADDRESS,
      units: [],
      clashes: [],
      ownStayDays: null,
      typeStayDays: null,
      contact: null,
      lastActivityAt: '2026-10-23T08:00:00.000Z',
      description: null,
      path: [
        {
          id: 'a',
          code: 'C4B1',
          name: 'Cabinet A',
          type: 'cabinet',
          kind: 'normal',
          ...NO_ADDRESS,
        },
        {
          id: 'b',
          code: 'A3F9',
          name: 'Box: vacuum parts',
          type: 'box',
          kind: 'normal',
          ...NO_ADDRESS,
        },
      ],
      children: [],
      contents: [
        {
          lotId: 'l1',
          part: {
            id: 'p',
            code: 'K7Q2',
            name: 'Bellows suction cup Ø30',
            status: 'active',
            manufacturer: 'Schmalz',
          },
          display: '14 pcs',
          in: null,
        },
      ],
      attachments: [],
    };
    renderAt('/l/A3F9', [{ path: '/l/:code', element: <LocationPage /> }], {
      '/api/locations/A3F9': detail,
    });
    expect(await screen.findByRole('heading', { name: 'Box: vacuum parts' })).toBeTruthy();
    expect(screen.getByText('Cabinet A')).toBeTruthy();
    expect(screen.getByText('Bellows suction cup Ø30')).toBeTruthy();
  });
});

describe('carry page', () => {
  it('lists carried things and puts the ticked ones down at the scanned destination', async () => {
    const carry: CarryState = {
      location: {
        id: 't',
        code: 'T1T1',
        name: 'Carried by demo',
        type: 'in_transit',
        kind: 'in_transit',
        ...NO_ADDRESS,
      },
      since: '2026-10-23T08:00:00.000Z',
      items: [
        {
          kind: 'location',
          id: 'box',
          code: 'A3F9',
          name: 'Box: vacuum parts',
          since: '2026-10-23T08:00:00.000Z',
        },
        {
          kind: 'lot',
          id: 'lot',
          part: { code: 'K7Q2', name: 'Suction cup' },
          display: '4 pcs',
          since: '2026-10-23T08:01:00.000Z',
        },
      ],
    };
    const dest: LocationDetail = {
      id: 'c',
      code: 'R2B4',
      name: 'Robot cell 2',
      type: 'zone',
      kind: 'normal',
      ...NO_ADDRESS,
      units: [],
      clashes: [],
      ownStayDays: null,
      typeStayDays: null,
      contact: null,
      lastActivityAt: '2026-10-23T08:00:00.000Z',
      description: null,
      path: [
        {
          id: 'c',
          code: 'R2B4',
          name: 'Robot cell 2',
          type: 'zone',
          kind: 'normal',
          ...NO_ADDRESS,
        },
      ],
      children: [],
      contents: [],
      attachments: [],
    };
    localStorage.setItem('ixfwms.token', 'ixf_test');
    const { fetchMock, router } = renderAt(
      '/carry?to=R2B4',
      [
        { path: '/carry', element: <CarryPage /> },
        { path: '/l/:code', element: <p>place</p> },
      ],
      {
        '/api/session': { name: 'demo', role: 'member', scopes: ['write'] },
        '/api/carry': carry,
        '/api/locations/R2B4': dest,
        '/api/carry/drop': { moved: 1, state: { ...carry, items: [] } },
      },
    );
    expect(await screen.findByText('Box: vacuum parts')).toBeTruthy();
    await userEvent.click(screen.getByLabelText('Suction cup'));
    await userEvent.click(await screen.findByRole('button', { name: 'Put 1 thing here' }));
    const drop = fetchMock.mock.calls.find(([input]) => input === '/api/carry/drop');
    expect(JSON.parse(drop?.[1]?.body as string)).toEqual({
      to: 'R2B4',
      items: ['box'],
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/l/R2B4'));
    localStorage.clear();
  });
});

describe('unknown codes', () => {
  it('offers to register a place for an unused code, such as a blank label', async () => {
    localStorage.setItem('ixfwms.token', 'ixf_test');
    renderAt('/l/ZZZ9', [{ path: '/l/:code', element: <LocationPage /> }], {
      '/api/session': { name: 'demo', role: 'member', scopes: ['write'] },
      '/api/codes/ZZZ9': { code: 'ZZZ9', assigned: null, reserved: true, free: false },
    });
    expect(await screen.findByRole('heading', { name: 'New place with code ZZZ9' })).toBeTruthy();
    localStorage.clear();
  });

  it("sends a merged duplicate's label to the part it was merged into", async () => {
    const { router } = renderAt(
      '/p/K7Q2',
      [
        { path: '/p/K7Q2', element: <NotFoundPage code="K7Q2" /> },
        { path: '/p/A3F9', element: <h1>Kept part</h1> },
      ],
      {
        '/api/codes/K7Q2': {
          code: 'K7Q2',
          assigned: null,
          reserved: false,
          free: false,
          retired: { at: '2026-10-24T10:00:00.000Z', note: 'was part M3 x 10' },
          forward: { kind: 'part', code: 'A3F9' },
        },
      },
    );
    expect(await screen.findByRole('heading', { name: 'Kept part' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/p/A3F9');
  });
});
