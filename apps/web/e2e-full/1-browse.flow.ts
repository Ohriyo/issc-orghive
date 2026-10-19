import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { expectAccessible } from './helpers';

/**
 * A signed-out student: home → college → organization → Paperworks → a document → download.
 * The file comes from object storage through a 5-minute signed URL, never through the API.
 */
test('a visitor browses to a public document and downloads it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'College of Engineering and Architecture' }).first().click();
  await expect(page).toHaveURL(/\/colleges\/cea$/);
  await expectAccessible(page, 'the college page');

  await page
    .getByRole('link', { name: 'Junior Philippine Institute of Civil Engineers' })
    .first()
    .click();
  await expect(page).toHaveURL(/\/orgs\/jpice$/);
  await page.getByRole('link', { name: 'Paperworks', exact: true }).click();
  await expect(page).toHaveURL(/\/orgs\/jpice\/paperworks/);
  await expectAccessible(page, 'Paperworks');

  await page
    .getByRole('link', { name: /Inter-Year Bridge Design Competition 2026/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/documents\//);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Bridge Design Competition');
  await expectAccessible(page, 'a document');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page
      .getByRole('button', { name: /Download/ })
      .first()
      .click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const body = readFileSync(await download.path());
  expect(body.subarray(0, 5).toString()).toBe('%PDF-');
});
