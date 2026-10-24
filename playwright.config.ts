import { defineConfig, devices } from '@playwright/test';

const PORT = 3931;

/** Browser tests of the everyday flows, on a phone, against a real server with an empty database. */
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: { ...devices['Pixel 7'], baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: 'node e2e/serve.mjs',
    url: `http://localhost:${PORT}/healthz`,
    env: { E2E_PORT: String(PORT) },
    timeout: 180_000,
  },
});
