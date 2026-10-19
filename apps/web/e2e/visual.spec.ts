import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openPage } from './open-page';

/*
 * Visual regression (F17, docs/DOMAIN_RULES.md decisions of 2026-10-18):
 * 1. Gating: each page must match its committed baseline (__screenshots__/). Baselines are
 *    rendered in the Playwright Docker image only, so fonts and anti-aliasing match in CI and
 *    locally; outside it these tests skip. Update them with `pnpm --filter web test:visual:update`.
 * 2. Not gating: a side-by-side image with the prototype in design/ and a similarity score,
 *    attached to the HTML report for a person to review. The prototype has other text and data,
 *    so a pixel match is never expected.
 */

const DESIGN_DIR = join(import.meta.dirname, '..', '..', '..', 'design');

const PAGES = [
  { name: 'home', path: '/', design: 'home.png', fullPage: true },
  { name: 'college-carousel', path: '/colleges', design: 'csc-carousel-cat.png', fullPage: false },
  { name: 'college-page', path: '/colleges/cea', design: 'college-cea.png', fullPage: true },
  { name: 'org-page', path: '/orgs/jpice', design: 'sbo-jpice.png', fullPage: false },
] as const;

test.skip(
  !process.env.ORGHIVE_VISUAL,
  'Visual baselines are rendered in the Playwright Docker image: run `pnpm --filter web test:visual`',
);

test.use({ viewport: { width: 1366, height: 768 } });

/**
 * In the browser: both images side by side as one PNG, and how alike they are (1 = same),
 * from the mean color difference of 64px-wide copies. Coarse on purpose: layout and color
 * blocks count, text does not.
 */
function compareWithDesign(page: Page, actual: Buffer, design: Buffer) {
  return page.evaluate(
    async ({ actualB64, designB64 }) => {
      const load = (b64: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = `data:image/png;base64,${b64}`;
        });
      const [a, d] = await Promise.all([load(actualB64), load(designB64)]);

      const pair = document.createElement('canvas');
      const gap = 24;
      pair.width = a.width + gap + d.width;
      pair.height = Math.max(a.height, d.height);
      const pctx = pair.getContext('2d')!;
      pctx.fillStyle = '#ff00ff';
      pctx.fillRect(0, 0, pair.width, pair.height);
      pctx.drawImage(a, 0, 0);
      pctx.drawImage(d, a.width + gap, 0);

      const W = 64;
      const H = Math.round((W * d.height) / d.width);
      const pixels = (img: HTMLImageElement) => {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const ctx = c.getContext('2d')!;
        // The same aspect as the design: the top of the page, scaled to its width.
        ctx.drawImage(img, 0, 0, img.width, (img.width * H) / W, 0, 0, W, H);
        return ctx.getImageData(0, 0, W, H).data;
      };
      const pa = pixels(a);
      const pd = pixels(d);
      let diff = 0;
      for (let i = 0; i < pa.length; i += 4) {
        diff +=
          Math.abs(pa[i]! - pd[i]!) +
          Math.abs(pa[i + 1]! - pd[i + 1]!) +
          Math.abs(pa[i + 2]! - pd[i + 2]!);
      }
      return {
        similarity: 1 - diff / ((pa.length / 4) * 3 * 255),
        sideBySide: pair.toDataURL('image/png').split(',')[1]!,
      };
    },
    { actualB64: actual.toString('base64'), designB64: design.toString('base64') },
  );
}

for (const target of PAGES) {
  test(`${target.name} matches its baseline`, async ({ page }, testInfo) => {
    // These run on `vite preview`, which sends the production security headers: the page
    // must render with the CSP enforced and break none of its rules.
    const violations: string[] = [];
    page.on('console', (message) => {
      if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
    });
    const response = await page.goto(target.path);
    expect(response?.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response?.headers()['x-content-type-options']).toBe('nosniff');
    await openPage(page, target.path);
    // Lazy logos below the fold must have arrived, or the first shot catches them loading.
    await page.waitForFunction(() =>
      Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0),
    );
    // Gating: our own baseline.
    await expect(page).toHaveScreenshot(`${target.name}.png`, {
      fullPage: target.fullPage,
      maxDiffPixelRatio: 0.002,
      // Tall full-page shots need longer than the 5s default to settle twice in a row.
      timeout: 20_000,
    });
    expect(violations, 'Content Security Policy violations').toEqual([]);

    // Not gating: beside the prototype, for review in the HTML report.
    const actual = await page.screenshot({ fullPage: target.fullPage });
    const design = readFileSync(join(DESIGN_DIR, target.design));
    const { similarity, sideBySide } = await compareWithDesign(page, actual, design);
    testInfo.annotations.push({
      type: 'design similarity',
      description: `${(similarity * 100).toFixed(1)}% like design/${target.design} (review, not gating)`,
    });
    await testInfo.attach(`${target.name} beside design (left: app, right: design)`, {
      body: Buffer.from(sideBySide, 'base64'),
      contentType: 'image/png',
    });
  });
}
