import { defineConfig, devices } from '@playwright/test';
import { API_PORT, definedEnv, WEB_DIR, WEB_PORT } from './env.mjs';

/**
 * The full-stack suite: real API, worker, Postgres, Redis, MinIO, ClamAV and mailpit (from
 * docker compose), nothing stubbed. `pnpm --filter web test:e2e:full` first resets the
 * orghive_e2e database (prepare.mjs), then this starts the apps on their own ports.
 *
 * Flows share one database, so they run one at a time and in file order.
 */
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // A scan waits on ClamAV; a deadline flow waits on the worker. Generous, but bounded.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Each flow signs in through the real form: refresh tokens rotate on every use, so a saved
  // session could not be shared between tests.
  projects: [
    {
      name: 'flows',
      testMatch: /\.flow\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } },
    },
  ],
  webServer: [
    {
      // The API and the worker together (start-backend.mjs): the worker serves no HTTP.
      command: 'node e2e-full/start-backend.mjs',
      cwd: WEB_DIR,
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      cwd: WEB_DIR,
      env: definedEnv({ ...process.env, ORGHIVE_API_PROXY: `http://localhost:${API_PORT}` }),
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
