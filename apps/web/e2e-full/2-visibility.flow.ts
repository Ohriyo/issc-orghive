import { expect, test, type Page } from '@playwright/test';
import { eventually, expectAccessible, SAMPLE_PDF, signIn, visitor } from './helpers';

/**
 * JPICE's account uploads a file; it stays with JPICE until ClamAV passes it; then JPICE
 * decides who sees it. A signed-out visitor sees it only while it is public, its college
 * council (CSC-CEA) also while it is for governing bodies, and nobody else while it is private
 * (CLAUDE.md, documents are never reviewed: visibility alone decides).
 */
const TITLE = `Barangay water survey (e2e ${Date.now().toString(36)})`;
const SEARCH_WORD = TITLE.match(/e2e \w+/)![0];

async function setVisibility(page: Page, value: 'public' | 'governing' | 'private') {
  const select = page.getByLabel(`Who can see it: ${TITLE}`);
  await select.selectOption(value);
  await expect(select).toBeEnabled();
  await expect(select).toHaveValue(value);
}

test('upload → scan → visibility decides what a visitor sees', async ({ page, browser }) => {
  await signIn(page, 'officer');

  // Upload: the bytes go browser → storage with a pre-signed URL.
  await page.goto('/orgs/jpice/paperworks/upload');
  await page.locator('input[type="file"]').setInputFiles(SAMPLE_PDF);
  await page.getByLabel('Title').fill(TITLE);
  await page.getByLabel('Type').selectOption({ index: 1 });
  // The shared account names the officer acting for it on every upload.
  await page.getByRole('textbox', { name: 'Acting as' }).fill('Juan Dela Cruz');
  await expectAccessible(page, 'the upload form with a file');
  await page.getByRole('button', { name: 'Upload file' }).click();
  // Success leaves the form (finish(toast), CLAUDE.md navigation rules); a failure stays on it.
  await expect(
    page.getByText('Uploaded. Only you see it until the virus scan passes'),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/\/upload/);

  // The worker scans it with ClamAV; until then only the uploader sees it.
  await page.goto('/dashboard/documents?org=jpice');
  const row = page.locator('li', { hasText: TITLE });
  await eventually(page, () => expect(row.getByText('Available')).toBeVisible({ timeout: 2_000 }));
  const href = await row.getByRole('link', { name: TITLE }).getAttribute('href');
  expect(href).toMatch(/^\/documents\//);
  // JPICE's own history names who uploaded it; nobody else ever sees that (checked below).
  await page.goto(href!);
  await expect(page.getByText('Uploaded by JPICE · acting as Juan Dela Cruz')).toBeVisible();
  await page.goto('/dashboard/documents?org=jpice');

  // Public lists are browser-cached for 60s by design (CLAUDE.md, Caching), so each look is
  // a new visitor with an empty cache: what the server serves right after the change.
  const paperworks = `/orgs/jpice/paperworks?q=${encodeURIComponent(SEARCH_WORD)}`;
  async function asVisitor(check: (guest: Page) => Promise<void>) {
    const guest = await visitor(browser);
    try {
      await check(guest.page);
    } finally {
      await guest.context.close();
    }
  }
  const listed = (guest: Page) => guest.getByRole('link', { name: TITLE });

  // Private (the upload default): a visitor does not see it.
  await asVisitor(async (guest) => {
    await guest.goto(paperworks);
    await expect(guest.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(guest.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(listed(guest)).toHaveCount(0);
  });

  // Public: listed in Paperworks and readable signed out.
  await setVisibility(page, 'public');
  await asVisitor(async (guest) => {
    await guest.goto(paperworks);
    await expect(listed(guest)).toBeVisible();
    await guest.goto(href!);
    await expect(guest.getByRole('heading', { level: 1 })).toHaveText(TITLE);
    await expect(guest.getByText(/acting as/i)).toHaveCount(0);
  });

  // Governing bodies: gone for a visitor, even by its direct link; its CSC still opens it.
  await setVisibility(page, 'governing');
  await asVisitor(async (guest) => {
    await guest.goto(href!);
    await expect(guest.getByRole('heading', { name: 'Document not found' })).toBeVisible();
    await guest.goto(paperworks);
    await expect(guest.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(listed(guest)).toHaveCount(0);
  });
  const council = await visitor(browser);
  try {
    await signIn(council.page, 'governor');
    await council.page.goto(href!);
    await expect(council.page.getByRole('heading', { level: 1 })).toHaveText(TITLE);

    // Private: JPICE's account alone, so its CSC no longer finds it either.
    await setVisibility(page, 'private');
    await council.page.goto(href!);
    await expect(council.page.getByRole('heading', { name: 'Document not found' })).toBeVisible();
  } finally {
    await council.context.close();
  }
});
