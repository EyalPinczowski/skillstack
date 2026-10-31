import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BASE,
  bodyOf,
  DATE,
  dayRoutes,
  decision,
  previewBody,
  suggestion,
} from '../../test/day-fixtures';
import { expectNoAxeViolations } from '../../test/axe';
import { apiError, fakeAuth, installApi, json, renderApp, SESSION } from '../../test/helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

const LIST = `GET ${BASE}/suggestions`;
const PREVIEW = `POST ${BASE}/suggestions/sg_1/preview`;
const ACCEPT = `POST ${BASE}/suggestions/sg_1/accept`;
const REJECT = `POST ${BASE}/suggestions/sg_1/reject`;

function open(extra: Parameters<typeof dayRoutes>[0] = {}) {
  const api = installApi(
    dayRoutes({
      [LIST]: () => json({ today: DATE, suggestions: [suggestion()] }),
      [PREVIEW]: () => json(previewBody('1 task moved, plan finish pushed back by 1 study day.')),
      [ACCEPT]: () => json(decision('1 task moved, plan finish pushed back by 1 study day.'), 201),
      [REJECT]: () => json({ ...decision('x'), summary: null }),
      ...extra,
    }),
  );
  renderApp({ auth: fakeAuth(SESSION), path: `/review/${DATE}` });
  return api;
}

async function card() {
  const heading = await screen.findByRole('heading', { name: 'Reduce your daily study time' });
  return within(heading.closest('article') as HTMLElement);
}

const requestTo = (api: ReturnType<typeof installApi>, key: string) =>
  api.calls.filter((c) => `${c.method} ${new URL(c.url).pathname}` === key);

describe('Suggestions panel', () => {
  it('shows each suggestion with its explanation, evidence and options, and applies nothing', async () => {
    const api = open();
    const c = await card();
    expect(c.getByText('You marked two days in a row as too much.')).toBeInTheDocument();
    expect(c.getByText(/Based on your reviews of Mon, Nov 9, Tue, Nov 10/)).toBeInTheDocument();
    expect(c.getByText(/Recommended:/)).toBeInTheDocument();
    expect(
      c.getByText(/Reduce 1 h from the daily study time on Monday, Tuesday\./),
    ).toBeInTheDocument();
    expect(c.getByText(/Alternative 1:/)).toBeInTheDocument();
    expect(c.getByText(/from Wed, Nov 11 to Fri, Nov 13/)).toBeInTheDocument();
    expect(requestTo(api, PREVIEW)).toHaveLength(0);
    expect(requestTo(api, ACCEPT)).toHaveLength(0);
    expect(requestTo(api, REJECT)).toHaveLength(0);
  });

  it('does not allow Accept before a preview, and the preview applies nothing', async () => {
    const user = userEvent.setup();
    const api = open();
    const c = await card();
    expect(c.getByRole('button', { name: /^Accept/ })).toBeDisabled();
    await user.click(c.getByRole('button', { name: /^Preview/ }));

    expect(
      await c.findByText('1 task moved, plan finish pushed back by 1 study day.'),
    ).toBeInTheDocument();
    expect(c.getByText(/Preview \(nothing is applied yet\)/)).toBeInTheDocument();
    expect(
      c.getByText(/Plan finish now: Friday, Nov 20\. With this change: Monday, Nov 23\./),
    ).toBeInTheDocument();
    expect(requestTo(api, PREVIEW)).toHaveLength(1);
    expect(new URL(requestTo(api, PREVIEW)[0]!.url).searchParams.get('option')).toBe('0');
    expect(requestTo(api, ACCEPT)).toHaveLength(0);
    expect(c.getByRole('button', { name: /^Accept/ })).toBeEnabled();
  });

  it('accepts with a body that holds only the option, then shows the change summary', async () => {
    const user = userEvent.setup();
    const api = open();
    const c = await card();
    await user.click(c.getByRole('radio', { name: /Alternative 1/ }));
    await user.click(c.getByRole('button', { name: /^Preview/ }));
    await c.findByText(/Preview \(nothing is applied yet\)/);
    expect(new URL(requestTo(api, PREVIEW)[0]!.url).searchParams.get('option')).toBe('1');
    await user.click(c.getByRole('button', { name: /^Accept/ }));

    await waitFor(() => expect(requestTo(api, ACCEPT)).toHaveLength(1));
    expect(await bodyOf(requestTo(api, ACCEPT)[0]!)).toEqual({ option: 1 });
    expect(
      await screen.findByText(
        /Reduce your daily study time: 1 task moved, plan finish pushed back/,
      ),
    ).toBeInTheDocument();
    // The accepted suggestion leaves the list (the list was reloaded).
    await waitFor(() => expect(requestTo(api, LIST).length).toBeGreaterThan(1));
  });

  it('throws the preview away when another option is chosen', async () => {
    const user = userEvent.setup();
    open();
    const c = await card();
    await user.click(c.getByRole('button', { name: /^Preview/ }));
    await c.findByText(/Preview \(nothing is applied yet\)/);
    await user.click(c.getByRole('radio', { name: /Alternative 1/ }));
    expect(c.queryByText(/Preview \(nothing is applied yet\)/)).toBeNull();
    expect(c.getByRole('button', { name: /^Accept/ })).toBeDisabled();
  });

  it('sends one accept for a double click', async () => {
    const user = userEvent.setup();
    let release: (response: Response) => void = () => {};
    const api = open({
      [ACCEPT]: () => new Promise<Response>((resolve) => (release = resolve)),
    });
    const c = await card();
    await user.click(c.getByRole('button', { name: /^Preview/ }));
    await c.findByText(/Preview \(nothing is applied yet\)/);
    await user.dblClick(c.getByRole('button', { name: /^Accept/ }));
    await waitFor(() => expect(requestTo(api, ACCEPT)).toHaveLength(1));
    release(json(decision('Done.'), 201));
    await screen.findByText(/Reduce your daily study time: Done\./);
    expect(requestTo(api, ACCEPT)).toHaveLength(1);
  });

  it('tells the person when the change was already applied (replayed)', async () => {
    const user = userEvent.setup();
    open({ [ACCEPT]: () => json(decision('old text', true)) });
    const c = await card();
    await user.click(c.getByRole('button', { name: /^Preview/ }));
    await c.findByText(/Preview \(nothing is applied yet\)/);
    await user.click(c.getByRole('button', { name: /^Accept/ }));
    expect(await screen.findByText(/already applied earlier/)).toBeInTheDocument();
  });

  it('refetches and explains when the suggestion is stale (409)', async () => {
    const user = userEvent.setup();
    let fresh = false;
    const api = open({
      [LIST]: () =>
        json({
          today: DATE,
          suggestions: fresh
            ? [suggestion({ id: 'sg_2', title: 'A newer suggestion' })]
            : [suggestion()],
        }),
      [ACCEPT]: () => {
        fresh = true;
        return apiError(409, 'conflict', 'This suggestion is not current.');
      },
    });
    const c = await card();
    await user.click(c.getByRole('button', { name: /^Preview/ }));
    await c.findByText(/Preview \(nothing is applied yet\)/);
    await user.click(c.getByRole('button', { name: /^Accept/ }));

    expect(
      await screen.findByText(/changed since these suggestions were loaded/),
    ).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'A newer suggestion' })).toBeInTheDocument();
    expect(requestTo(api, LIST).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('heading', { name: 'Reduce your daily study time' })).toBeNull();
  });

  it('refetches when the preview itself is stale (409)', async () => {
    const user = userEvent.setup();
    const api = open({ [PREVIEW]: () => apiError(409, 'conflict', 'Stale.') });
    const c = await card();
    await user.click(c.getByRole('button', { name: /^Preview/ }));
    expect(
      await screen.findByText(/changed since these suggestions were loaded/),
    ).toBeInTheDocument();
    await waitFor(() => expect(requestTo(api, LIST).length).toBeGreaterThanOrEqual(2));
  });

  it('shows an option the suggestion does not have (422) in words', async () => {
    const user = userEvent.setup();
    open({ [PREVIEW]: () => apiError(422, 'unprocessable', 'This suggestion has no option 0.') });
    const c = await card();
    await user.click(c.getByRole('button', { name: /^Preview/ }));
    expect(await c.findByText('This suggestion has no option 0.')).toBeInTheDocument();
  });

  it('rejects only when Reject is pressed', async () => {
    const user = userEvent.setup();
    const api = open();
    const c = await card();
    expect(requestTo(api, REJECT)).toHaveLength(0);
    await user.click(c.getByRole('button', { name: /^Reject/ }));
    await waitFor(() => expect(requestTo(api, REJECT)).toHaveLength(1));
    expect(await bodyOf(requestTo(api, REJECT)[0]!)).toEqual({});
    expect(await screen.findByText(/Rejected\. It will not be offered again/)).toBeInTheDocument();
    expect(requestTo(api, ACCEPT)).toHaveLength(0);
  });

  it('says when there are no suggestions', async () => {
    open({ [LIST]: () => json({ today: DATE, suggestions: [] }) });
    expect(await screen.findByText(/No suggestions right now/)).toBeInTheDocument();
  });

  it('describes the other kinds of change in plain words', async () => {
    open({
      [LIST]: () =>
        json({
          today: DATE,
          suggestions: [
            suggestion({
              id: 'sg_x',
              title: 'Estimates are off',
              proposedChange: {
                kind: 'estimateUpdate',
                taskType: 'course',
                factor: 1.3,
                taskIds: ['sql1', 'exam'],
              },
              alternatives: [],
              evidence: { reviewDates: [], taskIds: ['sql1'] },
            }),
            suggestion({
              id: 'sg_y',
              title: 'Add practice',
              proposedChange: { kind: 'extraPractice', afterTaskId: 'sql1', hours: 1 },
              alternatives: [{ kind: 'pullForward', date: '2026-11-12', hours: 1 }],
            }),
          ],
        }),
    });
    expect(
      await screen.findByText('Change the estimates of 2 unfinished course tasks up by 30%.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Based on Intro to SQL/)).toBeInTheDocument();
    expect(screen.getByText('Add 1 h of practice after Intro to SQL.')).toBeInTheDocument();
    expect(screen.getByText('Pull 1 h of work forward to Thu, Nov 12.')).toBeInTheDocument();
  });

  it('has no accessibility violations with a preview open', async () => {
    const user = userEvent.setup();
    open();
    const c = await card();
    await expectNoAxeViolations();
    await user.click(c.getByRole('button', { name: /^Preview/ }));
    await c.findByText(/Preview \(nothing is applied yet\)/);
    await expectNoAxeViolations();
  });
});
