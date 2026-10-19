import { expect, test } from '@playwright/test';
import { expectAccessible, signIn, visitor } from './helpers';

/**
 * An ISSC admin adds an SBO to CEA (F14). It shows in the college's public pages at once,
 * with no deploy: the admin change clears the cached public reads.
 */
const ACRONYM = `E2E${Date.now().toString(36).toUpperCase().slice(-4)}`;
const NAME = `Society of Testing Engineers ${ACRONYM}`;

test('an admin adds an SBO and visitors see it in the college at once', async ({
  page,
  browser,
}) => {
  await signIn(page, 'admin');
  await page.goto('/admin/organizations');
  await expect(page.getByRole('heading', { level: 1, name: 'Organizations' })).toBeVisible();
  await page.getByRole('button', { name: 'Add SBO to CEA' }).click();

  const sheet = page.getByRole('dialog', { name: 'Add an SBO to CEA' });
  await sheet.getByLabel('Short name').fill(ACRONYM);
  await expect(sheet.getByLabel('Link name')).toHaveValue(ACRONYM.toLowerCase());
  await sheet.getByLabel('Full name').fill(NAME);
  await expectAccessible(page, 'the add-organization sheet');
  await sheet.getByRole('button', { name: 'Add organization' }).click();
  await expect(page.getByText(`${ACRONYM} added.`)).toBeVisible();
  await expect(sheet).toBeHidden();

  // A visitor (empty cache) finds it in the CEA honeycomb and opens its page.
  const guest = await visitor(browser);
  try {
    await guest.page.goto('/colleges/cea');
    await guest.page.getByRole('link', { name: NAME }).first().click();
    await expect(guest.page).toHaveURL(new RegExp(`/orgs/${ACRONYM.toLowerCase()}$`));
    await expect(guest.page.getByRole('heading', { level: 1 })).toContainText(ACRONYM);
  } finally {
    await guest.context.close();
  }
});
