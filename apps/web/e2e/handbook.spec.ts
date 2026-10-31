import { expect, test, type Page } from '@playwright/test';
import { stubApi } from './fixtures';

/**
 * The Student Handbook as a visitor reads it: the homepage card opens the current edition's
 * pages, every edition opens by its year, and a past one links back to the current one.
 * The API is stubbed in the browser (fixtures.ts).
 */

async function pagesVisible(page: Page) {
  await expect(page.getByRole('img', { name: 'Page 1' })).toBeVisible({ timeout: 15_000 });
}

for (const viewport of [
  { name: 'phone', width: 360, height: 740 },
  { name: 'desktop', width: 1366, height: 768 },
]) {
  test.describe(`${viewport.name}: Student Handbook`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    test.beforeEach(async ({ page }) => stubApi(page));

    test('homepage card → the current edition’s pages', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('link', { name: 'Read the Handbook' }).click();
      await expect(page).toHaveURL((url) => url.pathname === '/handbook');
      await expect(page.getByRole('heading', { level: 1, name: 'Student Handbook' })).toBeVisible();
      await pagesVisible(page);
      await expect(page.getByText('Past edition', { exact: true })).toHaveCount(0);
    });

    test('every edition → an older one’s pages → View current edition', async ({ page }) => {
      await page.goto('/handbook');
      await page.getByRole('link', { name: 'Past editions' }).click();
      await expect(page).toHaveURL((url) => url.pathname === '/handbook/editions');

      await expect(page.getByRole('link', { name: /2026–2027\s*Current edition/ })).toHaveAttribute(
        'href',
        '/handbook/2026-2027',
      );
      await page.getByRole('link', { name: /2025–2026\s*Past edition/ }).click();
      await expect(page).toHaveURL((url) => url.pathname === '/handbook/2025-2026');
      await expect(page.getByText(/^The 2025–2026 edition, /)).toBeVisible();
      await expect(page.getByText('Past edition', { exact: true })).toBeVisible();
      await pagesVisible(page);

      await page.getByRole('link', { name: 'View current edition' }).click();
      await expect(page).toHaveURL((url) => url.pathname === '/handbook');
      await expect(page.getByText(/^The 2026–2027 edition, /)).toBeVisible();
      await expect(page.getByText('Past edition', { exact: true })).toHaveCount(0);
      await pagesVisible(page);
    });
  });
}
