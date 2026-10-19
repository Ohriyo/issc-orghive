import { expect, test, type Page } from '@playwright/test';
import { DOCUMENT_ID, stubApi } from './fixtures';

/**
 * Back navigation (CLAUDE.md "Navigation rules"): Back returns to the page the user came
 * from, else the screen's logical parent; every page has the header. The API is stubbed
 * in the browser (fixtures.ts) as an officer of JPICE or as a signed-out visitor.
 */

async function back(page: Page, label: string, expectedPath: string) {
  const button = page.getByRole('link', { name: `Back to ${label}` });
  await expect(button).toBeVisible();
  await button.click();
  await expect(page).toHaveURL((url) => url.pathname === expectedPath);
}

async function heading(page: Page, name: string | RegExp) {
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible({ timeout: 15_000 });
}

for (const viewport of [
  { name: 'desktop', width: 1366, height: 768 },
  { name: 'phone', width: 360, height: 740 },
]) {
  test.describe(`${viewport.name}: officer`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    test.beforeEach(async ({ page }) => stubApi(page, { signedIn: true }));

    test('dashboard → upload → Back returns to the dashboard', async ({ page }) => {
      await page.goto('/dashboard');
      await heading(page, 'JPICE');
      await page
        .getByRole('link', { name: /^Upload( document)?$/ })
        .filter({ visible: true })
        .first()
        .click();
      await heading(page, 'Upload Paperworks');
      await expect(page).toHaveURL(/\/orgs\/jpice\/paperworks\/upload$/);
      await back(page, 'Dashboard', '/dashboard');
      await heading(page, 'JPICE');
    });

    test('dashboard → document → Back returns to the dashboard', async ({ page }) => {
      await page.goto('/dashboard');
      await heading(page, 'JPICE');
      await page
        .getByRole('region', { name: 'Needs your attention' })
        .getByRole('link')
        .first()
        .click();
      await expect(page).toHaveURL(/\/documents\//);
      await back(page, 'Dashboard', '/dashboard');
    });

    test('opening /orgs/jpice/upload directly → Back goes to the dashboard', async ({ page }) => {
      await page.goto('/orgs/jpice/upload');
      await heading(page, 'Upload Paperworks');
      await expect(page).toHaveURL(/\/orgs\/jpice\/paperworks\/upload$/);
      await back(page, 'Dashboard', '/dashboard');
    });
  });

  test.describe(`${viewport.name}: visitor`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    test.beforeEach(async ({ page }) => stubApi(page));

    test('home → CEA → JPICE → Paperworks → document → Back returns to Paperworks', async ({
      page,
    }) => {
      await page.goto('/');
      await page
        .getByRole('region', { name: 'Colleges' })
        .getByRole('link', { name: 'College of Engineering and Architecture' })
        .click();
      await expect(page).toHaveURL(/\/colleges\/cea$/);
      await page
        .getByRole('link', { name: /Junior Philippine Institute of Civil Engineers|JPICE/ })
        .first()
        .click();
      await expect(page).toHaveURL(/\/orgs\/jpice$/);
      await page.getByRole('link', { name: 'Paperworks', exact: true }).first().click();
      await heading(page, 'Paperworks');
      await page.locator(`a[href="/documents/${DOCUMENT_ID}"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`/documents/${DOCUMENT_ID}$`));
      await back(page, 'JPICE Paperworks', '/orgs/jpice/paperworks');
      await heading(page, 'Paperworks');
    });

    test('a document opened directly → Back goes to its Paperworks', async ({ page }) => {
      await page.goto(`/documents/${DOCUMENT_ID}`);
      await back(page, 'JPICE Paperworks', '/orgs/jpice/paperworks');
    });
  });
}

test('every page has the header, and the header stays while scrolling', async ({ page }) => {
  await stubApi(page);
  await page.goto('/orgs/jpice/paperworks');
  await heading(page, 'Paperworks');
  await page.mouse.wheel(0, 1500);
  const banner = page.getByRole('banner');
  await expect(banner).toBeVisible();
  expect((await banner.boundingBox())?.y).toBe(0);
});
