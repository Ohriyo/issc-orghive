import { expect, test } from '@playwright/test';
import { expectAccessible } from './helpers';

/**
 * A signed-out student: home → college → organization → Paperworks → a document, which they
 * view as watermarked page images. The original is for the owning organization only: no
 * Download button, and the API refuses the link.
 */
test('a visitor browses to a public document and views it, but cannot download it', async ({
  page,
}) => {
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

  const viewerResponse = page.waitForResponse((res) =>
    /\/documents\/[^/]+\/viewer$/.test(res.url()),
  );
  await page
    .getByRole('link', { name: /Inter-Year Bridge Design Competition 2026/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/documents\//);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Bridge Design Competition');
  const documentId = /\/documents\/([^/?#]+)/.exec(page.url())![1]!;
  const { versionId } = (await (await viewerResponse).json()) as { versionId: string };

  // The worker renders the seeded file's pages (the seed queued them); then they show.
  const firstPage = page.getByRole('img', { name: 'Page 1' });
  await expect(firstPage).toBeVisible({ timeout: 90_000 });
  await expect
    .poll(() => firstPage.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(1000);
  await expectAccessible(page, 'a document');
  await expect(
    page.getByText('View only. This document cannot be downloaded or printed.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Download/ })).toHaveCount(0);

  // The page image is a watermarked WebP, private to this browser; the original never is.
  const src = (await firstPage.getAttribute('src'))!;
  const image = await page.request.get(src);
  expect(image.headers()['content-type']).toBe('image/webp');
  expect(image.headers()['cache-control']).toBe('private, max-age=300');
  const download = await page.request.get(
    `/api/v1/documents/${documentId}/versions/${versionId}/download-url`,
  );
  expect(download.status()).toBe(401);
});
