import { screen, waitFor } from '@testing-library/react';
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
});
