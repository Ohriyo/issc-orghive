import { expect, test, type Page } from '@playwright/test';
import { E2E_PROJECT_NAME, eventually, expectAccessible, SAMPLE_PDF, signIn } from './helpers';

/**
 * A missed deadline and its appeal (docs/PROJECT_WORKFLOW_SPEC.md, sections 2-3). The e2e seed
 * created the project 20 days ago, so its Project Proposal was due 6 days ago: the check on
 * read blocks it. JPICE's account appeals; the CSC-CEA account (which decides SBO appeals) approves
 * with a new due date; the project is unblocked and its proposal can be filed.
 */

/** `YYYY-MM-DD` in Manila, `days` from today: deadlines are Manila calendar days. */
function manilaDay(days: number): string {
  const at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(at);
}

async function openProject(page: Page) {
  await page.goto('/dashboard/projects?org=jpice');
  await page.getByRole('link', { name: E2E_PROJECT_NAME }).first().click();
  await expect(page).toHaveURL(/\/projects\//);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(E2E_PROJECT_NAME);
}

test('missed deadline → appeal → approved → unblocked → proposal filed', async ({
  page,
  browser,
}) => {
  // Two people, two sign-ins and two virus scans: longer than one page's flow.
  test.setTimeout(240_000);

  // The officer finds the project blocked, its checklist locked.
  await signIn(page, 'officer');
  await openProject(page);
  await expect(page.getByText('Blocked', { exact: true }).first()).toBeVisible();
  const proposal = page.getByRole('region', { name: 'Project Proposal' });
  await expect(proposal.getByText('Locked while the project is blocked.')).toBeVisible();
  await expectAccessible(page, 'a blocked project');

  // They appeal to the CSC.
  await page.getByRole('link', { name: 'Submit appeal' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Appeal the block' })).toBeVisible();
  await page
    .getByLabel('Reason')
    .fill('Our adviser was on fieldwork, so the proposal could not be signed before the deadline.');
  await expectAccessible(page, 'the appeal form');
  await page.getByRole('button', { name: /Submit appeal to CSC-CEA/ }).click();
  await expect(page.getByText('Appeal submitted. CSC-CEA will decide it.')).toBeVisible();

  // The CSC-CEA Governor approves it with a new due date, in their own session.
  const governor = await browser.newContext({ reducedMotion: 'reduce' });
  try {
    const decider = await governor.newPage();
    await signIn(decider, 'governor');
    await decider.goto('/dashboard/appeals');
    const appeal = decider.locator('article', { hasText: E2E_PROJECT_NAME });
    await appeal.getByRole('button', { name: 'Approve…' }).click();
    await expectAccessible(decider, 'the approve form');
    const form = decider.getByRole('form', { name: 'Approve the appeal' });
    await form.getByLabel('New due date').fill(manilaDay(7));
    await form.getByRole('button', { name: 'Approve appeal' }).click();
    await expect(decider.getByText(/Approved\. JPICE can continue\./)).toBeVisible();
  } finally {
    await governor.close();
  }

  // Unblocked: the proposal is open again, and filing it submits the task once scanned.
  await openProject(page);
  await expect(page.getByText('Blocked', { exact: true })).toHaveCount(0);
  await expect(proposal.getByText('Locked while the project is blocked.')).toHaveCount(0);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    proposal.getByRole('button', { name: /Upload file/ }).click(),
  ]);
  await chooser.setFiles(SAMPLE_PDF);
  await eventually(page, () =>
    expect(
      page
        .getByRole('region', { name: 'Project Proposal' })
        .getByText('Submitted', { exact: true }),
    ).toBeVisible({
      timeout: 2_000,
    }),
  );
});
