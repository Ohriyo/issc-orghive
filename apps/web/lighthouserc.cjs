/**
 * Lighthouse CI (pre-launch review, item 4): mobile Lighthouse on the production build of the
 * home, college and Paperworks pages, with real data. Run with `pnpm --filter web
 * test:lighthouse` (e2e-full/lighthouse.mjs starts the API, worker and `vite preview`).
 *
 * Every category must score at least 90 on every page; the median of 3 runs is asserted.
 * Lighthouse's default emulation is a mid-range phone on a throttled 4G network.
 */
const { chromium } = require('@playwright/test');

const BASE = 'http://localhost:5174';
const MIN = 0.9;

module.exports = {
  ci: {
    collect: {
      url: [`${BASE}/`, `${BASE}/colleges/cea`, `${BASE}/orgs/jpice/paperworks`],
      numberOfRuns: 3,
      // Playwright's Chromium, already installed for the e2e suites.
      chromePath: process.env.CHROME_PATH || chromium.executablePath(),
      settings: { chromeFlags: '--no-sandbox --headless=new' },
    },
    assert: {
      aggregationMethod: 'median-run',
      assertions: {
        'categories:performance': ['error', { minScore: MIN }],
        'categories:accessibility': ['error', { minScore: MIN }],
        'categories:best-practices': ['error', { minScore: MIN }],
        'categories:seo': ['error', { minScore: MIN }],
      },
    },
    upload: { target: 'filesystem', outputDir: './lighthouse-report' },
  },
};
