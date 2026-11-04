import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderAt } from '../test/render';
import { HomePage } from './home';

const routes = [
  { path: '/', element: <HomePage /> },
  { path: '/items', element: <h1>Items list</h1> },
];

const empty = { '/api/categories': [], '/api/map-drawings': [] };

afterEach(() => localStorage.clear());

describe('front page', () => {
  it('asks what you are looking for and answers with the way there', async () => {
    renderAt('/', routes, {
      ...empty,
      '/api/where': [
        {
          item: { code: 'G1UE', name: 'Hot glue gun', kind: 'tool' },
          unit: null,
          text: 'Hot glue gun: 2 pcs at RL-B-2.',
          directions: [
            { name: 'Robotics lab', type: 'room' },
            { name: 'Cabinet B', type: 'cabinet', hint: 'grey, by the project bench' },
            { name: 'Shelf 2', type: 'shelf', position: { n: 2, of: 5, from: 'bottom' } },
          ],
        },
      ],
      '/api/parts': {
        rows: [{ partId: 'p1', unitId: null }],
        items: [{ id: 'p1', code: 'G1UE', name: 'Hot glue gun', units: [], stock: [] }],
        total: 1,
        builds: [],
      },
    });
    expect(await screen.findByRole('heading', { name: 'What are you looking for?' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Scan a label/ })).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Search items'), 'glue');
    const answer = await screen.findByRole('link', { name: /Hot glue gun/ });
    expect(answer.getAttribute('href')).toBe('/p/G1UE');
    expect(answer.textContent).toContain('grey, by the project bench');
    expect(answer.textContent).toContain('(2 of 5 from the bottom)');
  });

  it('is the Items list for people who are logged in, and for old /?q= links', async () => {
    localStorage.setItem('ixfwms.token', 'ixf_test');
    const { router } = renderAt('/', routes, {
      ...empty,
      '/api/session': { name: 'demo', role: 'member', scopes: ['write'] },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/items'));
    localStorage.clear();

    const old = renderAt('/?tag=Demo', routes, empty).router;
    await waitFor(() => expect(old.state.location.pathname).toBe('/items'));
    expect(old.state.location.search).toBe('?tag=Demo');
  });
});
