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

  await test.step('open the day briefing from Today', async () => {
    await page.getByRole('link', { name: 'Open the day briefing' }).click();
    await expect(page).toHaveURL(/\/briefing\/2026-11-02$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Day briefing' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Overview', level: 2 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Overview' })).toContainText('of study');
    const tasks = page.getByRole('region', { name: 'Tasks' });
    await expect(tasks.getByRole('heading', { name: title, level: 3 }).first()).toBeVisible();
    await expectNoA11yViolations(page, 'the day briefing');
  });

  await test.step('start the study day from the briefing', async () => {
    await page.getByRole('button', { name: 'Start study day' }).click();
    await expect(page).toHaveURL(/\/$/);
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
    await expect(page.getByRole('link', { name: 'Review the day' })).toBeVisible();
    await expectNoA11yViolations(page, 'Today after the day ended');
  });
});

/**
 * What the UI offers after "Not yet" on the estimate prompt. Documented, not judged: the prompt is
 * the only place on Today with a "Mark as done" action for a task whose block is used up.
 */
test('daily loop: after "Not yet" the task stays open and Today offers no way to complete it', async ({
  page,
  user,
}) => {
  await signIn(page, user);
  await loadDemoPlan(page);
  const first = page.getByRole('region', { name: 'Today’s blocks' }).locator('ul > li').first();
  const title = (await first.getByRole('heading', { level: 3 }).innerText()).trim();
  await page.getByRole('button', { name: 'Start study day' }).click();
  await first.getByRole('button', { name: 'Log time' }).click();
  await first.getByRole('button', { name: 'Log time', exact: true }).click();

  const prompt = page.getByRole('group', { name: `Estimate reached: ${title}` });
  await prompt.getByRole('button', { name: 'Not yet' }).click();

  await test.step('Today: the question is gone, the task is listed as worked on, nothing else', async () => {
    await expect(prompt).toHaveCount(0);
    const workedOn = page.getByRole('region', { name: 'Worked on today' });
    await expect(workedOn).toContainText(title);
    await expect(workedOn).toContainText('Today 0.5 h · Estimated 0.5 h · Actual 0.5 h');
    await expect(workedOn.getByRole('button')).toHaveCount(0);
    // The block is used up, so the task has left "Today's blocks" and its "Mark done" with it.
    const blocks = page.getByRole('region', { name: 'Today’s blocks' });
    await expect(blocks.getByRole('heading', { name: title, level: 3 })).toHaveCount(0);
    await expect(page.getByRole('button').filter({ hasText: title })).toHaveCount(0);
    await expect(page.getByText(`Marked ${title} as done.`)).toHaveCount(0);
  });

  await test.step('the task page shows hours and status but no complete action', async () => {
    await page.goto('/plan/setup');
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByText('0.5 h of 0.5 h')).toBeVisible();
    await expect(page.getByRole('button').filter({ hasText: title })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Reopen/ })).toHaveCount(0);
  });

  await test.step('after a reload the question does not come back', async () => {
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Worked on today' })).toContainText(title);
    await expect(page.getByRole('group', { name: /Estimate reached/ })).toHaveCount(0);
    await expect(page.getByRole('button').filter({ hasText: title })).toHaveCount(0);
  });
});
