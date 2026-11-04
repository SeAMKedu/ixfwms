import type { PartSummary } from '@ixfwms/domain';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { SearchPage } from '../pages/search';
import { renderAt } from '../test/render';
import { ShortcutProvider, useShortcut } from './shortcuts';

function Demo() {
  const [log, setLog] = useState<string[]>([]);
  useShortcut('e', 'edit', () => setLog((l) => [...l, 'e']));
  useShortcut('g p', 'parts', () => setLog((l) => [...l, 'g p']));
  useShortcut('?', 'help', () => setLog((l) => [...l, '?']));
  return (
    <>
      <input aria-label="field" />
      <output data-testid="log">{log.join(',')}</output>
    </>
  );
}

describe('keyboard shortcuts', () => {
  it('runs single keys and sequences, but never while typing', async () => {
    render(
      <ShortcutProvider>
        <Demo />
      </ShortcutProvider>,
    );
    await userEvent.keyboard('e');
    await userEvent.keyboard('gp');
    await userEvent.keyboard('?');
    expect(screen.getByTestId('log').textContent).toBe('e,g p,?');

    await userEvent.click(screen.getByLabelText('field'));
    await userEvent.keyboard('e');
    expect(screen.getByTestId('log').textContent).toBe('e,g p,?');
    expect(screen.getByLabelText('field')).toHaveProperty('value', 'e');

    // Escape leaves the field, and shortcuts work again.
    await userEvent.keyboard('{Escape}e');
    expect(screen.getByTestId('log').textContent).toBe('e,g p,?,e');
  });

  it('ignores keys pressed with Ctrl or Cmd', async () => {
    render(
      <ShortcutProvider>
        <Demo />
      </ShortcutProvider>,
    );
    await userEvent.keyboard('{Control>}e{/Control}{Meta>}e{/Meta}');
    expect(screen.getByTestId('log').textContent).toBe('');
  });

  it('moves through search results with j/k and opens one with Enter', async () => {
    const part = (code: string, name: string): PartSummary => ({
      id: code,
      code,
      name,
      manufacturer: null,
      status: 'active',
      kind: 'part',
      tracking: 'bulk',
      cut: null,
      container: null,
      aliases: [],
      units: [],
      category: null,
      identifiers: [],
      tags: [],
      stock: [],
    });
    const { router } = renderAt(
      '/',
      [
        { path: '/', element: <SearchPage /> },
        { path: '/p/:code', element: <p>part page</p> },
      ],
      {
        '/api/parts': {
          total: 2,
          builds: [],
          rows: [
            { partId: 'K7Q2', unitId: null },
            { partId: 'A3F9', unitId: null },
          ],
          items: [part('K7Q2', 'Cup'), part('A3F9', 'Fitting')],
        },
        '/api/categories': [],
        '/api/tags': [],
      },
    );
    await screen.findAllByText('Fitting');
    await userEvent.keyboard('jj');
    await userEvent.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe('/p/A3F9');
  });
});
