import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Browser, type Page } from '@playwright/test';
import { API_DIR, e2eEnv, PASSWORD_ENV } from './env.mjs';

/**
 * The seeded shared organization accounts (apps/api/prisma/seed/data.ts, `accountEmail`):
 * JPICE's own account, its college council (CSC-CEA, which decides its appeals), and the
 * ISSC's, which administers.
 */
export const ACCOUNTS = {
  officer: 'jpice@orghive.local',
  governor: 'csc-cea@orghive.local',
  admin: 'issc@orghive.local',
  /** Another SBO of CEA, for the leaderboard flow's second change. */
  rival: 'jiiee@orghive.local',
} as const;
export type Account = keyof typeof ACCOUNTS;

/** The e2e seed's project (apps/api/prisma/seed/e2e.ts). */
export const E2E_PROJECT_NAME = 'Inter-Year Bridge Design Competition (e2e)';

/** The e2e seed's leaderboard projects: event today, proposal in. */
export const LEADERBOARD_PROJECTS = {
  jpice: 'Leaderboard Fun Run (e2e)',
  jiiee: 'Leaderboard Relay (e2e)',
} as const;

/** A real PDF from the seed's sample Paperworks, uploaded under another title. */
export const SAMPLE_PDF = resolve(
  API_DIR,
  'prisma',
  'seed',
  'assets',
  'jpice-barangay-water-survey-report.pdf',
);

function password(): string {
  const value = e2eEnv()[PASSWORD_ENV];
  if (!value) throw new Error(`Set ${PASSWORD_ENV} for the seeded accounts`);
  return value;
}

/** Signs in through the real form and waits for the dashboard. */
export async function signIn(page: Page, account: Account) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ACCOUNTS[account]);
  await page.getByRole('textbox', { name: 'Password' }).fill(password());
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
}

/** A fresh, signed-out visitor in their own browser context. */
export async function visitor(browser: Browser) {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  return { context, page: await context.newPage() };
}

/** WCAG 2.2 AA, as in the stubbed suite, on whatever the page shows right now. */
export async function expectAccessible(page: Page, what: string) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const violations = result.violations.map(
    (v) => `${v.id} (${v.impact ?? 'n/a'}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(violations, `axe WCAG 2.2 AA violations on ${what}`).toEqual([]);
}

/**
 * Reloads until `ready` passes or `timeoutMs` runs out: for work the worker does in the
 * background (the virus scan, the compliance check).
 */
export async function eventually(
  page: Page,
  ready: () => Promise<void>,
  { timeoutMs = 90_000, everyMs = 2_000 } = {},
) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      await ready();
      return;
    } catch (error) {
      if (Date.now() > until) throw error;
      await page.waitForTimeout(everyMs);
      await page.reload();
    }
  }
}
