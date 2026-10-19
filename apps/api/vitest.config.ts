import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Repository tests read DATABASE_URL_TEST from apps/api/.env; CI sets it directly.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Repository tests share one test database, so files run one at a time.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**', 'src/server.ts', 'src/worker.ts'],
      reporter: ['text-summary', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      // Business rules live in the services (CLAUDE.md): together and each on its own, at
      // least 80% covered, so one weak service cannot hide behind well-tested ones.
      thresholds: {
        'src/services/**/*.ts': {
          statements: 80,
          lines: 80,
          functions: 80,
          branches: 80,
          perFile: { statements: 80, lines: 80, functions: 80 },
        },
      },
    },
  },
});
