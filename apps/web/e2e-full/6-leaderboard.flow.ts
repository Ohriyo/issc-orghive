import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { eventually, LEADERBOARD_PROJECTS, SAMPLE_PDF, signIn, type Account } from './helpers';

/**
 * The live leaderboard (docs/LEADERBOARD_PHASES.md, Phase 4.2), nothing stubbed. The e2e seed
 * put IECEP, PSME and UAPSA on the SBO podium. A visitor keeps the homepage open while an SBO
 * files its project's ACR and Financial Report: once the real scan passes, the worker
 * recomputes, and the podium reorders on the open page without a reload. With full motion the
 * Top 3 effects play; with reduced motion they do not.
 */

/** The SBO podium's acronyms, in rank order. */
function podiumOrder(podium: Locator): Promise<string[]> {
  return podium
    .locator('li')
    .evaluateAll((items) =>
      items.map((li) => li.querySelector('a span.text-h3')?.textContent ?? ''),
    );
}

/** A visitor on the homepage, counting any navigation after the first load. */
async function watchHomepage(browser: Browser, reducedMotion: 'reduce' | 'no-preference') {
  const context = await browser.newContext({
    reducedMotion,
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  await page.goto('/');
  const podium = page.getByRole('list', { name: 'Top 3 Student Body Organizations' });
  await podium.scrollIntoViewIfNeeded();
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });
  return { context, page, podium, navigations: () => navigations };
}

/**
 * The SBO's account files its project's ACR and Financial Report through the real form and
 * waits for both to pass the scan. Returns when the officer sees both submitted.
 */
async function fileReports(page: Page, slug: 'jpice' | 'jiiee', account: Account, income: string) {
  await signIn(page, account);
  await page.goto(`/dashboard/projects?org=${slug}`);
  await page.getByRole('link', { name: LEADERBOARD_PROJECTS[slug] }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(LEADERBOARD_PROJECTS[slug]);
  await page.getByRole('textbox', { name: 'Acting as' }).first().fill('Juan Dela Cruz');

  const acr = page.getByRole('region', { name: 'Activity Completion Report' });
  const [acrChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    acr.getByRole('button', { name: /Upload file/ }).click(),
  ]);
  await acrChooser.setFiles(SAMPLE_PDF);

  const report = page.getByRole('region', { name: 'Financial Report' });
  await report.getByRole('textbox', { name: 'Total income (₱)' }).fill(income);
  await report.getByRole('textbox', { name: 'Total expenses (₱)' }).fill('10,000.00');
  const [reportChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    report.getByRole('button', { name: /Upload file/ }).click(),
  ]);
  await reportChooser.setFiles(SAMPLE_PDF);

  for (const name of ['Activity Completion Report', 'Financial Report']) {
    await eventually(page, () =>
      expect(
        page.getByRole('region', { name }).getByText('Submitted', { exact: true }),
      ).toBeVisible({ timeout: 2_000 }),
    );
  }
}

test('a completed project enters the SBO Top 3 live; the effects follow reduced motion', async ({
  browser,
}) => {
  // Two virus scans per organization, twice, and the recompute's 5 s debounce each time.
  test.setTimeout(360_000);

  // 1. Full motion: JPICE files its reports while a visitor watches.
  const lively = await watchHomepage(browser, 'no-preference');
  expect(await podiumOrder(lively.podium)).toEqual(['IECEP', 'PSME', 'UAPSA']);
  expect(
    await lively.page
      .getByTestId('hex-shimmer')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('hex-shimmer');

  const officer = await browser.newContext();
  try {
    await fileReports(await officer.newPage(), 'jpice', 'officer', '50,000.00');
  } finally {
    await officer.close();
  }
  const filed = Date.now();
  // ₱40,000.00 beats IECEP's ₱3,000.00 at one point each.
  await expect
    .poll(() => podiumOrder(lively.podium), { timeout: 20_000, intervals: [250] })
    .toEqual(['JPICE', 'IECEP', 'PSME']);
  const latency = `podium reordered ${Date.now() - filed} ms after the officer saw both reports submitted`;
  test.info().annotations.push({ type: 'live update', description: latency });
  console.log(`leaderboard flow: ${latency}`);
  expect(lively.navigations(), 'the page updated without a reload').toBe(0);
  // The confetti burst played (its pieces fade out but stay in the page).
  await expect(lively.page.getByTestId('confetti')).toHaveCount(1);
  const jpice = lively.podium.locator('li').first();
  await expect(jpice).toContainText('₱40,000.00');
  await expect(jpice).toContainText('1 pt · 1 project');

  // 2. Reduced motion: JIIEE overtakes while another visitor watches.
  const calm = await watchHomepage(browser, 'reduce');
  expect(await podiumOrder(calm.podium)).toEqual(['JPICE', 'IECEP', 'PSME']);
  expect(
    await calm.page
      .getByTestId('hex-shimmer')
      .first()
      .evaluate((el) => getComputedStyle(el).display),
  ).toBe('none');

  const rival = await browser.newContext();
  try {
    await fileReports(await rival.newPage(), 'jiiee', 'rival', '90,000.00');
  } finally {
    await rival.close();
  }
  await expect
    .poll(() => podiumOrder(calm.podium), { timeout: 20_000, intervals: [250] })
    .toEqual(['JIIEE', 'JPICE', 'IECEP']);
  expect(calm.navigations(), 'the page updated without a reload').toBe(0);
  await expect(calm.page.getByTestId('confetti')).toHaveCount(0);
  // An instant swap: no card is mid-animation.
  expect(
    await calm.podium
      .locator('li')
      .evaluateAll((items) => items.map((li) => getComputedStyle(li).transform)),
  ).toEqual(['none', 'none', 'none']);

  // The visitor with full motion saw this change too, with its own burst.
  await expect
    .poll(() => podiumOrder(lively.podium), { timeout: 20_000 })
    .toEqual(['JIIEE', 'JPICE', 'IECEP']);

  await lively.context.close();
  await calm.context.close();
});
