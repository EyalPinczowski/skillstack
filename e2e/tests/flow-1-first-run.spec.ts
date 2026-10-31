import { expect, expectNoA11yViolations, signIn, test } from '../fixtures';

/** Spec 9, flow 1: first run. Sign in, accept the Terms, import the demo plan, see Today. */
test('first run: sign in, accept the Terms, load the demo plan and see Today', async ({
  page,
  user,
}) => {
  await test.step('signed out, the app asks for a sign-in', async () => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/signin$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoA11yViolations(page, 'the sign-in page');
  });

  await test.step('a signed token opens the Terms screen first', async () => {
    await signIn(page, user);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Before you continue' })).toBeVisible();
    await expectNoA11yViolations(page, 'the Terms screen');
    // Nothing of the app is reachable before the Terms are accepted.
    await expect(page.getByRole('link', { name: 'Today', exact: true })).toHaveCount(0);
  });

  await test.step('the box must be ticked before continuing', async () => {
    await page.getByRole('button', { name: 'Accept and continue' }).click();
    await expect(page.getByText('Tick the box to continue.')).toBeVisible();
    await page
      .getByLabel('I have read and accept the Terms of Use and the Privacy Policy.')
      .check();
    await page.getByRole('button', { name: 'Accept and continue' }).click();
  });

  await test.step('with no plan yet, Today offers the import', async () => {
    await expect(page.getByRole('heading', { name: 'No plan yet' })).toBeVisible();
    await expectNoA11yViolations(page, 'Today without a plan');
  });

  await test.step('the demo plan loads and Today shows its blocks and the progress bar', async () => {
    await page.getByRole('button', { name: 'Load the demo plan' }).click();
    await expect(page.getByRole('heading', { name: 'Today’s blocks' })).toBeVisible();
    await expect(page.getByText('Junior Data Analyst (fictional demo plan)').first()).toBeVisible();

    const blocks = page.getByRole('region', { name: 'Today’s blocks' }).getByRole('listitem');
    await expect(blocks.first()).toBeVisible();
    expect(await blocks.count()).toBeGreaterThan(0);

    const progress = page.getByRole('progressbar', { name: 'Plan progress' });
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAttribute('aria-valuenow', '0');
    await expect(page.getByRole('button', { name: 'Start study day' })).toBeVisible();
    await expectNoA11yViolations(page, 'Today with the demo plan');
  });

  await test.step('the plan survives a reload (it is stored by the API, not the browser)', async () => {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Today’s blocks' })).toBeVisible();
  });
});
