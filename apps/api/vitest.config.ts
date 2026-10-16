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
  },
});
