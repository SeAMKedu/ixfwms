import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import i18next from 'eslint-plugin-i18next';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      'data/**',
      'apps/server/drizzle/**',
      'apps/web/vite.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        project: ['./tsconfig.tests.json', './apps/web/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, i18next },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // All visible UI text goes through t() so the app can be translated (Finnish later).
      'i18next/no-literal-string': ['error', { mode: 'jsx-text-only' }],
    },
  },
  {
    // Keep files and functions (React components included) small enough to read in one go.
    files: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.ts'],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 200, skipBlankLines: true, skipComments: true }],
    },
  },
  // Files over the limits when they were set. Lower a number when you split one; never raise it.
  ...Object.entries({
    'apps/server/src/db/schema.ts': [450],
    'apps/server/src/mcp/server.ts': [700, 650],
    'apps/server/src/services/locations.ts': [600],
    'apps/server/src/services/maps.ts': [550],
    'apps/server/src/services/parts.ts': [700],
    'apps/server/src/services/stock.ts': [450],
    'apps/server/src/services/units.ts': [600],
    'apps/web/src/api/queries.ts': [450],
    'apps/web/src/components/model-map.tsx': [400, 250],
    'apps/web/src/components/place-picker.tsx': [400, 250],
    'apps/web/src/pages/bom.tsx': [400, 300],
    'apps/web/src/pages/import.tsx': [400, 250],
    'apps/web/src/pages/part-edit.tsx': [450, 350],
    'apps/web/src/pages/part/lot-row.tsx': [400, 300],
    'apps/web/src/pages/unit/where.tsx': [400, 250],
    'apps/web/src/pages/users.tsx': [500],
  }).map(([file, [lines, perFunction = 200]]) => ({
    files: [file],
    rules: {
      'max-lines': ['error', { max: lines, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'error',
        { max: perFunction, skipBlankLines: true, skipComments: true },
      ],
    },
  })),
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**/*.ts'],
    // expect.objectContaining() and friends are typed as any
    rules: { '@typescript-eslint/no-unsafe-assignment': 'off', 'i18next/no-literal-string': 'off' },
  },
  prettier,
);
