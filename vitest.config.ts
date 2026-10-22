import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['development'] },
  ssr: { resolve: { conditions: ['development'] } },
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['packages/*/src/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['apps/*/src/**/*.test.ts'],
          testTimeout: 20000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**', 'apps/*/src/**'],
      // cli/main are thin wiring; schema.ts is declarative table definitions
      exclude: [
        '**/*.test.ts',
        '**/test/**',
        'apps/server/src/cli.ts',
        'apps/server/src/main.ts',
        'apps/server/src/db/schema.ts',
      ],
      thresholds: { lines: 70, functions: 70, branches: 60 },
    },
  },
});
