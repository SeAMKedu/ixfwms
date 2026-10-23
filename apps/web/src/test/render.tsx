import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { createQueryClient } from '../app';
import { SessionProvider } from '../auth/session';
import { ShortcutProvider } from '../lib/shortcuts';

/** Renders a page at `path` with real routing and react-query, and a fake fetch for the API. */
export function renderAt(
  path: string,
  routes: { path: string; element: ReactNode }[],
  api: Record<string, unknown>,
) {
  const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.pathname + input.search
          : input.url;
    const key = Object.keys(api).find((k) => url === k || url.startsWith(`${k}?`));
    const body = key ? api[key] : { error: 'not_found', message: `No mock for ${url}` };
    // Strings that look like markup are served as text (e.g. SVG files); everything else as JSON.
    const text = typeof body === 'string' && body.trimStart().startsWith('<');
    return Promise.resolve(
      new Response(text ? body : JSON.stringify(body), {
        status: key ? 200 : 404,
        headers: { 'content-type': text ? 'image/svg+xml' : 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <QueryClientProvider client={createQueryClient()}>
      <SessionProvider>
        <ShortcutProvider>
          <RouterProvider router={router} />
        </ShortcutProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return { ...utils, router, fetchMock };
}
