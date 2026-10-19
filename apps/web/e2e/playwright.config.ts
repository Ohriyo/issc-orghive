import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
/**
 * Visual baselines (visual.spec.ts) are taken from a production build: it loads fast and
 * renders the same every time, with no dev overlay or on-demand compiling.
 */
const VISUAL = !!process.env.ORGHIVE_VISUAL;

/**
 * End-to-end checks. The API is stubbed in the browser (see fixtures.ts), so only the web
 * dev server runs: no database, Redis or object storage needed, locally or in CI.
 */
export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  ...(VISUAL && { timeout: 60_000 }),
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Reveals appear at once and the WebGL background stays off: stable layouts to measure.
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  // Baselines are rendered only in the Playwright Docker image (see visual.spec.ts), so they
  // carry no platform suffix.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['visual.spec.ts'],
    },
    {
      name: 'visual',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ['visual.spec.ts'],
    },
  ],
  webServer: {
    command: VISUAL
      ? `pnpm exec vite build && pnpm exec vite preview --port ${PORT} --strictPort`
      : `pnpm exec vite --port ${PORT} --strictPort`,
    // The config lives in e2e/; Vite runs from the app root.
    cwd: '..',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: VISUAL ? 600_000 : 120_000,
  },
});
