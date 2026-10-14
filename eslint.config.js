import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['**/dist', '**/coverage', '**/node_modules', '**/playwright-report']),

  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },

  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },

  // ---- apps/api ----
  {
    files: ['apps/api/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Layer rule: only repositories touch Prisma.
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/**/repositories/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@prisma/client',
                '@prisma/client/*',
                '**/generated/prisma',
                '**/generated/prisma/*',
              ],
              message: 'Only repositories may import Prisma (see CLAUDE.md layer rules).',
            },
          ],
        },
      ],
    },
  },
  {
    // Layer rule: services hold business rules and never see req/res.
    files: ['apps/api/src/**/services/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'express', message: 'Services must not depend on Express (no req/res).' },
          ],
          patterns: [
            {
              group: [
                '@prisma/client',
                '@prisma/client/*',
                '**/generated/prisma',
                '**/generated/prisma/*',
              ],
              message: 'Only repositories may import Prisma (see CLAUDE.md layer rules).',
            },
          ],
        },
      ],
    },
  },

  // ---- apps/web ----
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },
  {
    // Layer rule: views render props and emit events; presenters own data fetching.
    files: ['apps/web/src/**/views/**/*.{ts,tsx}', 'apps/web/src/**/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tanstack/react-query',
              message: 'Fetch data in a presenter hook, not in a view.',
            },
            { name: '@/lib/api', message: 'Call the API from a presenter hook, not from a view.' },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Fetch data in a presenter hook, not in a view.' },
      ],
    },
  },
  {
    // shadcn/ui files export variants alongside components by design.
    files: ['apps/web/src/components/ui/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },

  {
    files: ['**/*.{test,spec}.{ts,tsx}', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },

  // Must be last: turns off rules that conflict with Prettier.
  prettier,
]);
