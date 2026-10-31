import { acceptCurrentLegal, importDemoPlan } from '../support/api';
import { expect, signIn, test } from '../fixtures';

/**
 * Spec 9, flow 3: review and adjust. Two study days in a row rated "too much" lead to the
 * capacity-reduction suggestion; it is previewed (nothing saved), accepted, and the finish moves.
 *
 * The demo plan starts on Sunday 2026-11-01 and the server's clock is fixed on Monday 2026-11-02
 * (TEST-ONLY E2E_NOW), so those are the two consecutive study days.
 */
const SUNDAY = '2026-11-01';
const MONDAY = '2026-11-02';

const review = (date: string) => ({
  date,
  difficulty: 3,
  density: 5, // "too much"
  energy: 3,
  note: '',
  outcomes: [],
});

interface Suggestion {
  id: string;
  rule: string;
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
    const first = await api.put(`${plan}/days/${SUNDAY}/review`, { data: review(SUNDAY) });
    expect(first.status()).toBe(201);
    expect((await suggestions()).filter((s) => s.rule === 'density_too_high')).toEqual([]);
  });

  let suggestion: Suggestion;
  await test.step('the second heavy day in a row suggests a lower capacity', async () => {
    const second = await api.put(`${plan}/days/${MONDAY}/review`, { data: review(MONDAY) });
    expect(second.status()).toBe(201);
    const found = (await suggestions()).find((s) => s.rule === 'density_too_high');
    expect(found, 'a density_too_high suggestion').toBeDefined();
    suggestion = found!;
  });

  let proposedFinishDate: string;
  await test.step('the preview shows the change summary and saves nothing', async () => {
    const response = await api.post(`${plan}/suggestions/${suggestion.id}/preview?option=0`);
    expect(response.status()).toBe(200);
    const preview = await response.json();
    expect(preview.summary.text).toContain('pushed back');
    expect(preview.proposedFinishDate > preview.currentFinishDate).toBe(true);
    proposedFinishDate = preview.proposedFinishDate;

    await page.reload();
    await expect(finishLine()).toHaveText(before);
    expect((await suggestions()).map((s) => s.id)).toContain(suggestion.id);
  });

  await test.step('accepting applies it once, and the finish date moves on screen', async () => {
    const accepted = await api.post(`${plan}/suggestions/${suggestion.id}/accept`, {
      data: { option: 0 },
    });
    expect(accepted.status()).toBe(201);
    expect(await accepted.json()).toMatchObject({ replayed: false });

    const schedule = await (await api.get(`${plan}/schedule`)).json();
    expect(schedule.finishDate).toBe(proposedFinishDate);

    await page.reload();
    await expect(finishLine()).not.toHaveText(before);
    expect((await suggestions()).map((s) => s.id)).not.toContain(suggestion.id);
  });
});

// The end-of-day review screen and the suggestion cards (spec 3.4) are built in PR #40
// (feature/web-briefing-review), which is not on this base yet. The test above drives the same
// steps through the API and checks the result on the Today screen. When the screens exist, replace
// the API calls with the screen: open /review/:date, rate the day "too much" on two study days,
// open the suggestion, use "Preview", check the change summary, accept, and check the finish date.
test.fixme('review and adjust: the same flow through the review screen', async () => {
  // Needs /review/:date from PR #40.
});
