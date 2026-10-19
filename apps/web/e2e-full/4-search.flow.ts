import { expect, test } from '@playwright/test';
import { expectAccessible, signIn, visitor } from './helpers';

/**
 * Search (F12): PostgreSQL full text over titles, tags and extracted PDF text, with the same
 * visibility filter as Paperworks. Runs after the visibility flow, whose upload ends private.
 */
test('Ctrl+K finds a public document and opens it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.keyboard.press('Control+K');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('searchbox', { name: 'Search Paperworks' }).fill('bridge');
  const hit = dialog
    .getByRole('link', { name: /Inter-Year Bridge Design Competition 2026/ })
    .first();
  await expect(hit).toBeVisible();
  await expectAccessible(page, 'the search overlay with results');
  await hit.click();
  await expect(page).toHaveURL(/\/documents\//);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Bridge Design Competition');
});

test('search applies visibility: the officer finds a private file, a visitor does not', async ({
  page,
  browser,
}) => {
  // The visibility flow's upload ("… (e2e …)") ended private. Its officer finds it, which
  // proves it is indexed; so a visitor's empty result is the filter at work, not a gap.
  const privateHit = (p: typeof page) => p.getByRole('link', { name: /\(e2e / });

  await signIn(page, 'officer');
  await page.goto('/search?q=e2e');
  await expect(privateHit(page).first()).toBeVisible();

  const guest = await visitor(browser);
  try {
    await guest.page.goto('/search?q=e2e');
    await expect(guest.page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(guest.page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(privateHit(guest.page)).toHaveCount(0);
    // And public files are found by words inside their PDF.
    await guest.page.goto('/search?q=potable');
    await expect(
      guest.page.getByRole('link', { name: /Barangay Potable Water Survey/ }).first(),
    ).toBeVisible();
    await expectAccessible(guest.page, 'search results');
  } finally {
    await guest.context.close();
  }
});
