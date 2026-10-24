import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect, type APIRequestContext } from '@playwright/test';

/** The admin token e2e/serve.mjs made for this run. */
const token = () => readFileSync(join(import.meta.dirname, '.data', 'token'), 'utf8').trim();

interface Fixtures {
  /** The REST API as the admin, for setting up places and stock. */
  api: APIRequestContext;
  /** A page where the admin is logged in. */
  signedIn: void;
}

export const test = base.extend<Fixtures>({
  api: async ({ playwright, baseURL }, use) => {
    const api = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { authorization: `Bearer ${token()}` },
    });
    await use(api);
    await api.dispose();
  },
  signedIn: async ({ page }, use) => {
    await page.addInitScript((t) => localStorage.setItem('ixfwms.token', t), token());
    await use();
  },
});

export { expect };

/** POSTs JSON and returns the response body, failing the test on an error status. */
export async function post<T>(api: APIRequestContext, url: string, data: unknown): Promise<T> {
  const res = await api.post(url, { data });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

/** A name nobody else in this run uses, so tests don't see each other's things. */
export const unique = (name: string) => `${name} ${Math.random().toString(36).slice(2, 7)}`;
