import { expect, expectNoA11yViolations, signIn, test } from '../fixtures';
import { loadDemoPlan } from '../support/ui';

/** Spec 9, flow 2: the daily loop. Start the day, log time, mark done on purpose, end the day. */
test('daily loop: start, log time, the estimate prompt, mark done, end the day', async ({
  page,
  user,
}) => {
  await signIn(page, user);
  await loadDemoPlan(page);

  const blocks = page.getByRole('region', { name: 'Today’s blocks' }).locator('ul > li');
  const first = blocks.first();
  const progress = page.getByRole('progressbar', { name: 'Plan progress' });
  await expect(first).toBeVisible();
  const title = (await first.getByRole('heading', { level: 3 }).innerText()).trim();
  const planned = await progress.getAttribute('aria-valuetext');
  expect(planned).toMatch(/^0 percent, 0 h of /);

  await test.step('start the study day', async () => {
    await page.getByRole('button', { name: 'Start study day' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Day started.' })).toBeVisible();
    await expect(page.getByText('Day started', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'End day' })).toBeVisible();
    await expectNoA11yViolations(page, 'Today after the day started');
  });

  await test.step('log the block’s time on the first task: progress changes', async () => {
    await first.getByRole('button', { name: 'Log time' }).click();
    await expectNoA11yViolations(page, 'the log time form');
    await first.getByRole('button', { name: 'Log time', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: `on ${title}.` })).toBeVisible();
    await expect(progress).not.toHaveAttribute('aria-valuetext', planned!);
    await expect(progress).toHaveAttribute('aria-valuetext', /^\d+ percent, 0\.5 h of /);
  });

  // The block is used up, so the task moves to "Worked on today" and stays open.
  const workedOn = page.getByRole('region', { name: 'Worked on today' });
  const prompt = page.getByRole('group', { name: `Estimate reached: ${title}` });

  await test.step('reaching the estimate only asks; nothing is marked done by itself', async () => {
    await expect(prompt).toContainText("You've reached the estimate. Mark as done?");
    await expect(workedOn).toContainText(title);
    await expect(workedOn.getByRole('button', { name: 'Reopen' })).toHaveCount(0);
    await expect(page.getByText(`Marked ${title} as done.`)).toHaveCount(0);
    await expectNoA11yViolations(page, 'the estimate prompt');
  });

  await test.step('marking done is an explicit click on the prompt', async () => {
    await prompt.getByRole('button', { name: 'Mark as done' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: `Marked ${title} as done.` }),
    ).toBeVisible();
    await expect(prompt).toHaveCount(0);
    await expect(workedOn.getByRole('button', { name: 'Reopen' })).toBeVisible();
  });

  await test.step('end the day after confirming', async () => {
    await page.getByRole('button', { name: 'End day' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'End today?' });
    await expect(dialog).toBeVisible();
    await expectNoA11yViolations(page, 'the end day dialog');
    await dialog.getByRole('button', { name: 'End day' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Day ended.' })).toBeVisible();
    await expect(page.getByText('Day ended', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'End day' })).toHaveCount(0);
    await expectNoA11yViolations(page, 'Today after the day ended');
  });
});

// The briefing screen (spec 3.2) is built in PR #40 (feature/web-briefing-review), which is not on
// this base yet: Today only shows a placeholder sentence after "Start study day". Remove the
// `fixme` and fill in the steps below when /briefing/:date exists.
test.fixme('daily loop: the briefing opens after the day starts', async ({ page, user }) => {
  await signIn(page, user);
  await loadDemoPlan(page);
  await page.getByRole('button', { name: 'Start study day' }).click();
  // Expected once PR #40 is merged: a link to the briefing, then the day's overview, the tasks
  // in time order with their lessons, no console errors and no accessibility violations.
});
