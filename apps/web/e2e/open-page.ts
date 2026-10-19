import { expect, type Page } from '@playwright/test';
import { stubApi } from './fixtures';

/** Loads a route, waits for content, and scrolls once so every scroll reveal has run. */
export async function openPage(
  page: Page,
  path: string,
  signedIn = false,
  admin = false,
  superAdmin = false,
) {
  await stubApi(page, { signedIn, admin, superAdmin });
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
