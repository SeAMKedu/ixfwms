import type { LocationDetail, PartSummary } from '@ixfwms/domain';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderAt } from '../test/render';
import { LocationPage } from './location';
import { ScanPage } from './scan';
import { SearchPage } from './search';

const part = (over: Partial<PartSummary>): PartSummary => ({
  id: over.code ?? 'x',
  code: 'A3F9',
  name: 'Part',
  manufacturer: null,
  status: 'active',
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
            stock: [{ display: '14 pcs', location: 'Box', locationCode: 'A3F9' }],
          }),
          part({ code: 'P2X1', name: 'Vacuum generator VN-10', status: 'draft' }),
        ],
      },
      '/api/categories': [],
      '/api/tags': [],
    });
    expect((await screen.findAllByText('Bellows suction cup Ø30')).length).toBeGreaterThan(0);
    expect(screen.getByText('2 parts')).toBeTruthy();
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
      description: null,
      path: [
        { id: 'a', code: 'C4B1', name: 'Cabinet A', type: 'cabinet', kind: 'normal' },
        { id: 'b', code: 'A3F9', name: 'Box: vacuum parts', type: 'box', kind: 'normal' },
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
