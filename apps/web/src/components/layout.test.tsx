import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderAt } from '../test/render';
import { Layout } from './layout';

describe('navigation without a login', () => {
  it('leaves out the Inbox, Import and More', async () => {
    renderAt('/', [{ path: '/', element: <Layout /> }], {
      '/api/parts': { rows: [], items: [], total: 0, builds: [] },
      '/api/reports': [],
    });
    await waitFor(() =>
      expect(screen.getAllByRole('link', { name: 'Items' }).length).toBeGreaterThan(0),
    );
    expect(screen.getAllByRole('link', { name: 'Places' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /Inbox/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Import' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('opens the sidebar links in a menu on phones, closed by picking a page', async () => {
    const { router } = renderAt('/', [{ path: '*', element: <Layout /> }], {
      '/api/parts': { rows: [], items: [], total: 0, builds: [] },
      '/api/reports': [],
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Menu' }));
    const menu = screen.getByRole('complementary', { name: 'Menu' });
    expect(menu.textContent).toContain('Can we build it?');
    await userEvent.click(screen.getAllByRole('link', { name: 'Can we build it?' }).at(-1)!);
    await waitFor(() => expect(router.state.location.pathname).toBe('/bom'));
    expect(screen.queryByRole('complementary', { name: 'Menu' })).toBeNull();
  });
});
