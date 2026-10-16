import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

/**
 * End-to-end checks. The API is stubbed in the browser (see fixtures.ts), so only the web
 * dev server runs: no database, Redis or object storage needed, locally or in CI.
 */
export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Reveals appear at once and the WebGL background stays off: stable layouts to measure.
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    // The config lives in e2e/; Vite runs from the app root.
    cwd: '..',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
