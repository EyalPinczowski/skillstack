import type { Page } from '@playwright/test';
import { acceptCurrentLegal, importDemoPlan } from '../support/api';
import { expect, expectNoA11yViolations, signIn, test } from '../fixtures';

/**
 * Spec 9, flow 3: review and adjust, through the real screens. Two study days in a row rated
 * "too much" lead to the capacity-reduction suggestion; it is previewed (nothing saved), accepted,
 * and the finish date moves. API calls are cross-checks only.
 *
 * The demo plan starts on Sunday 2026-11-01 and the server's clock is fixed on Monday 2026-11-02
 * (TEST-ONLY E2E_NOW), so those are the two consecutive study days.
 */
const SUNDAY = '2026-11-01';
const MONDAY = '2026-11-02';

interface Suggestion {
  id: string;
  rule: string;
}

/** Fills and saves the end-of-day review of a date with the day rated "too much". */
async function submitHeavyReview(page: Page, date: string): Promise<void> {
  await page.goto(`/review/${date}`);
  await expect(page.getByRole('heading', { level: 1, name: 'End-of-day review' })).toBeVisible();
  await page.getByRole('radio', { name: '3 of 5, Medium' }).check({ force: true });
  await page.getByRole('radio', { name: '5 of 5, Too much' }).check({ force: true });
  await page.getByRole('radio', { name: '3 of 5, OK' }).check({ force: true });
  await page.getByRole('button', { name: 'Save review' }).click();
  await expect(page.getByRole('button', { name: 'Update review' })).toBeVisible();
}

test('review and adjust: two heavy days, preview, accept, and the finish date moves', async ({
  page,
  api,
  user,
}) => {
  await acceptCurrentLegal(api);
  const planId = await importDemoPlan(api);
  const plan = `/api/v1/plans/${planId}`;
  const suggestions = async () =>
    ((await (await api.get(`${plan}/suggestions`)).json()) as { suggestions: Suggestion[] })
      .suggestions;
  const finishLine = () => page.getByRole('region', { name: 'Plan summary' }).getByText(/^Finish /);

  await signIn(page, user);
  await page.goto('/');
  const before = (await finishLine().innerText()).trim();

  await test.step('one heavy day is not enough to suggest anything', async () => {
    await submitHeavyReview(page, SUNDAY);
    await expect(page.getByText('No suggestions right now.')).toBeVisible();
    expect((await suggestions()).filter((s) => s.rule === 'density_too_high')).toEqual([]);
    await expectNoA11yViolations(page, 'the review after one day');
  });

  await test.step('the second heavy day in a row shows the suggestion', async () => {
    await submitHeavyReview(page, MONDAY);
    const panel = page.getByRole('region', { name: 'Suggestions for your plan' });
    await expect(panel.getByRole('article')).toBeVisible();
    await expect(panel.getByText('Why we suggest this')).toBeVisible();
    expect((await suggestions()).filter((s) => s.rule === 'density_too_high')).toHaveLength(1);
    await expectNoA11yViolations(page, 'the review with a suggestion');
  });

  const card = page.getByRole('region', { name: 'Suggestions for your plan' }).getByRole('article');
  let suggestion: Suggestion;

  await test.step('Accept is disabled until the change was previewed; the preview saves nothing', async () => {
    suggestion = (await suggestions()).find((s) => s.rule === 'density_too_high')!;
    await expect(card.getByRole('button', { name: 'Accept' })).toBeDisabled();
    await expect(card.getByText('Preview the change first')).toBeVisible();

    await card.getByRole('button', { name: 'Preview' }).click();
    await expect(card.getByText('Preview (nothing is applied yet)')).toBeVisible();
    await expect(card).toContainText('pushed back');
    await expect(card.getByRole('button', { name: 'Accept' })).toBeEnabled();
    await expectNoA11yViolations(page, 'the suggestion preview');

    // Cross-check: still only a suggestion, the plan is unchanged.
    expect((await suggestions()).map((s) => s.id)).toContain(suggestion.id);
    const schedule = await (await api.get(`${plan}/schedule`)).json();
    const preview = await (
      await api.post(`${plan}/suggestions/${suggestion.id}/preview?option=0`)
    ).json();
    expect(schedule.finishDate).toBe(preview.currentFinishDate);
    expect(preview.proposedFinishDate > preview.currentFinishDate).toBe(true);
  });

  await test.step('accepting applies it once, and the finish date moves', async () => {
    const preview = await (
      await api.post(`${plan}/suggestions/${suggestion.id}/preview?option=0`)
    ).json();
    await card.getByRole('button', { name: 'Accept' }).click();
    await expect(
      page
        .getByRole('region', { name: 'Suggestions for your plan' })
        .locator('[role="status"][aria-live="polite"]'),
    ).toContainText('pushed back');

    // Cross-checks: the API applied exactly what was previewed, and the suggestion is used up.
    const schedule = await (await api.get(`${plan}/schedule`)).json();
    expect(schedule.finishDate).toBe(preview.proposedFinishDate);
    expect((await suggestions()).map((s) => s.id)).not.toContain(suggestion.id);

    await page.goto('/');
    await expect(finishLine()).not.toHaveText(before);
  });
});
