import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { PUBLIC_ROUTES, SIGNED_IN_ROUTES, stubApi } from './fixtures';

/**
 * The responsive rules from CLAUDE.md, enforced on every public route at every width:
 * no page-level horizontal scroll, every button and link at least 44x44px, and no axe
 * WCAG 2.2 AA violations.
 */

const VIEWPORTS = [
  { name: 'phone 360', width: 360, height: 740, touch: true },
  { name: 'tablet 768', width: 768, height: 1024, touch: true },
  { name: 'laptop 1366', width: 1366, height: 768, touch: false },
  { name: 'desktop 1920', width: 1920, height: 1080, touch: false },
] as const;

const MIN_TARGET = 44;

/** Loads a route, waits for content, and scrolls once so every scroll reveal has run. */
async function open(page: Page, path: string, signedIn = false) {
  await stubApi(page, { signedIn });
  await page.goto(path);
  // Generous: the first visit to each lazy route compiles it on the dev server.
  await expect(page.locator('h1').first()).toBeAttached({ timeout: 15_000 });
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(async () => {
    const step = Math.round(innerHeight * 0.6);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.scrollTo(0, 0);
  });
}

/** Elements wider than the viewport that no ancestor clips: the cause of a side scroll. */
function overflowCulprits(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const clips = (el: Element) =>
      ['hidden', 'clip', 'auto', 'scroll'].includes(getComputedStyle(el).overflowX);
    const culprits: string[] = [];
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || (r.right <= vw + 1 && r.left >= -1)) continue;
      let clipped = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (clips(a)) {
          clipped = true;
          break;
        }
      }
      if (!clipped)
        culprits.push(
          `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} (${Math.round(r.left)}..${Math.round(r.right)})`,
        );
    }
    return culprits.slice(0, 5);
  });
}

/**
 * Visible buttons and links whose hit area is under 44x44px. The hit area is probed with
 * elementFromPoint, so an invisible `tap-area` layer around a text link counts.
 */
function smallTargets(page: Page) {
  return page.evaluate(async (min) => {
    const small: string[] = [];
    const targets = [...document.querySelectorAll<HTMLElement>('a[href], button, [role="button"]')];
    for (const el of targets) {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      if (
        box.width < 2 ||
        box.height < 2 ||
        style.visibility === 'hidden' ||
        Number(style.opacity) === 0
      )
        continue;
      if (el.closest('[aria-hidden="true"], [inert], .sr-only')) continue;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const r = el.getBoundingClientRect();
      const hits = (x: number, y: number) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && (hit === el || el.contains(hit));
      };
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (!hits(cx, cy)) continue; // covered by something else: not reachable here anyway
      let up = 0,
        down = 0,
        left = 0,
        right = 0;
      while (up < min && hits(cx, r.top - up - 1)) up++;
      while (down < min && hits(cx, r.bottom + down + 1)) down++;
      while (left < min && hits(r.left - left - 1, cy)) left++;
      while (right < min && hits(r.right + right + 1, cy)) right++;
      const w = r.width + left + right;
      const h = r.height + up + down;
      if (w < min - 0.5 || h < min - 0.5) {
        const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40);
        small.push(`${el.tagName.toLowerCase()} "${name}" ${Math.round(w)}x${Math.round(h)}`);
      }
    }
    window.scrollTo(0, 0);
    return small;
  }, MIN_TARGET);
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.touch,
    });

    const cases = [
      ...PUBLIC_ROUTES.map((path) => ({ path, signedIn: false })),
      ...SIGNED_IN_ROUTES.map((path) => ({ path, signedIn: true })),
    ];
    for (const { path, signedIn } of cases) {
      test(`${path}${signedIn ? ' (signed in)' : ''}`, async ({ page }) => {
        await open(page, path, signedIn);

        // Every page renders inside AppShell: one header, with the way home.
        await expect(page.getByRole('banner')).toHaveCount(1);
        await expect(page.getByRole('link', { name: 'Orghive home' })).toBeVisible();

        const width = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          inner: window.innerWidth,
        }));
        expect(
          width.scroll,
          `horizontal overflow at ${viewport.width}px, caused by: ${(await overflowCulprits(page)).join('; ')}`,
        ).toBeLessThanOrEqual(width.inner);

        expect(await smallTargets(page), 'buttons/links with a hit area under 44x44px').toEqual([]);

        const axe = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        const violations = axe.violations.map(
          (v) =>
            `${v.id} (${v.impact}): ${v.help} -> ${v.nodes
              .map((n) => n.target.join(' '))
              .slice(0, 3)
              .join(', ')}`,
        );
        expect(violations, 'axe WCAG 2.2 AA violations').toEqual([]);
      });
    }
  });
}
