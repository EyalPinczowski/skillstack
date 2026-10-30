import { onlineManager } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { apiError, fakeAuth, installApi, json, renderApp, SESSION } from '../test/helpers';
import {
  anchorAtRisk,
  NOW,
  PLAN_ID,
  planRoutes,
  planSummary,
  progress,
  schedule,
  taskView,
} from '../test/plan-fixtures';

afterEach(() => {
  onlineManager.setOnline(true);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const BASE = `/api/v1/plans/${PLAN_ID}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function open(extra: Parameters<typeof planRoutes>[0] = {}) {
  const api = installApi(planRoutes(extra));
  renderApp({ auth: fakeAuth(SESSION), path: '/' });
  return api;
}

const logResult = (suggestDone: boolean, hours = 1.5) => ({
  log: {
    id: '33333333-3333-4333-8333-333333333333',
    planId: PLAN_ID,
    taskId: 'sql1',
    date: '2026-11-10',
    hours,
    createdAt: NOW,
  },
  task: taskView({ doneHours: suggestDone ? 3 : 1 + hours }),
  suggestDone,
});

async function todaysBlock() {
  const heading = await screen.findByRole('heading', { name: 'Today’s blocks' });
  const section = heading.closest('section') as HTMLElement;
  return within(within(section).getAllByRole('listitem')[0]!);
}

describe('Today', () => {
  it('shows the date, day of the plan, progress and finish date', async () => {
    open();
    expect(await screen.findByText('Tuesday, Nov 10')).toBeInTheDocument();
    expect(screen.getByText(/Day 8 of 18/)).toBeInTheDocument();
    expect(screen.getByText('Demo plan', { exact: false })).toBeInTheDocument();
    const bar = await screen.findByRole('progressbar', { name: 'Plan progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '33');
    expect(screen.getByText('33%')).toBeInTheDocument();
    expect(screen.getByText('1.5 h done of 4.5 h planned')).toBeInTheDocument();
    expect(screen.getByText('Fri, Nov 20')).toBeInTheDocument();
    expect(screen.getByText('0 of 1')).toBeInTheDocument();
  });

  it('lists today’s blocks with type chip, time range, title, hours and actions', async () => {
    open();
    const block = await todaysBlock();
    expect(block.getByRole('heading', { name: 'Intro to SQL' })).toBeInTheDocument();
    expect(block.getByText('Course')).toBeInTheDocument();
    expect(block.getByText('09:00–10:30')).toBeInTheDocument();
    expect(block.getByText(/1\.5 h · 1 h of 3 h done/)).toBeInTheDocument();
    for (const name of ['Log time', 'Mark done', 'Skip']) {
      expect(block.getByRole('button', { name: new RegExp(name) })).toBeInTheDocument();
    }
  });

  it('groups the days after today, with type labels for fixed exams', async () => {
    open();
    const heading = await screen.findByRole('heading', { name: 'Coming up' });
    const section = within(heading.closest('section') as HTMLElement);
    expect(section.getByRole('heading', { name: /Wed, Nov 11/ })).toBeInTheDocument();
    expect(section.getByRole('heading', { name: /Thu, Nov 19/ })).toBeInTheDocument();
    expect(section.getByText('Exam')).toBeInTheDocument();
    expect(section.getByText('SQL exam')).toBeInTheDocument();
  });

  it('pins an exam-at-risk warning as text with an icon', async () => {
    open({ [`GET ${BASE}/schedule`]: () => json(schedule({ warnings: [anchorAtRisk] })) });
    const region = await screen.findByRole('region', { name: 'Schedule warnings' });
    expect(region).toHaveTextContent('Exam at risk:');
    expect(region).toHaveTextContent('SQL exam, Thu, Nov 19 at 10:00');
    expect(region).toHaveTextContent('add about 1.5 h of study, or add a study day');
    expect(region.querySelector('svg')).not.toBeNull();
    await expectNoAxeViolations();
  });

  it('says so when nothing is scheduled today and builds no skills UI', async () => {
    open({ [`GET ${BASE}/schedule`]: () => json(schedule({ blocks: [] })) });
    expect(await screen.findByText('Nothing is scheduled for today.')).toBeInTheDocument();
    expect(screen.queryByText(/skills in your schedule/i)).not.toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    open();
    await screen.findByRole('heading', { name: 'Today’s blocks' });
    await screen.findByRole('progressbar');
    await expectNoAxeViolations();
  });

  it('shows a plan switcher only when there is more than one plan', async () => {
    open();
    await screen.findByText('Tuesday, Nov 10');
    expect(screen.queryByRole('combobox', { name: 'Plan' })).not.toBeInTheDocument();
  });

  it('switches plans with a simple select when there are two', async () => {
    const OTHER = '44444444-4444-4444-8444-444444444444';
    const seen: string[] = [];
    open({
      'GET /api/v1/plans': () =>
        json({ plans: [planSummary(), planSummary({ id: OTHER, name: 'Second plan' })] }),
      [`GET /api/v1/plans/${OTHER}/schedule`]: () => {
        seen.push(OTHER);
        return json(schedule({ blocks: [] }));
      },
      [`GET /api/v1/plans/${OTHER}/tasks`]: () => json({ tasks: [] }),
      [`GET /api/v1/plans/${OTHER}/progress`]: () => json(progress()),
    });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Plan' }), 'Second plan');
    await waitFor(() => expect(seen).toContain(OTHER));
    expect(await screen.findByText(/Second plan/, { selector: 'span' })).toBeInTheDocument();
  });

  describe('log time', () => {
    it('sends a client-generated uuid, today’s date, hours and note, and shows the result', async () => {
      let body: Record<string, unknown> = {};
      const api = open({
        [`POST ${BASE}/tasks/sql1/logs`]: async (request) => {
          body = (await request.json()) as Record<string, unknown>;
          return json(logResult(false, 0.75), 201);
        },
      });
      const user = userEvent.setup();
      const block = await todaysBlock();
      await user.click(block.getByRole('button', { name: /Log time/ }));
      const hours = block.getByRole('spinbutton', { name: 'Hours' });
      expect(hours).toHaveValue(1.5);
      await user.clear(hours);
      await user.type(hours, '0.75');
      await user.type(block.getByRole('textbox', { name: /Note/ }), 'Finished lesson 2');
      await user.click(block.getAllByRole('button', { name: 'Log time' }).at(-1)!);
      expect(await screen.findByText(/Logged 0\.75 h on Intro to SQL/)).toBeInTheDocument();
      expect(body).toMatchObject({ date: '2026-11-10', hours: 0.75, note: 'Finished lesson 2' });
      expect(body.id).toMatch(UUID);
      expect(api.count(`POST ${BASE}/tasks/sql1/complete`)).toBe(0);
      expect(screen.queryByText(/reached the estimate/)).not.toBeInTheDocument();
    });

    it('refuses hours that are not a positive number without calling the API', async () => {
      const api = open();
      const user = userEvent.setup();
      const block = await todaysBlock();
      await user.click(block.getByRole('button', { name: /Log time/ }));
      const hours = block.getByRole('spinbutton', { name: 'Hours' });
      await user.clear(hours);
      await user.type(hours, '0');
      await user.click(block.getAllByRole('button', { name: 'Log time' }).at(-1)!);
      expect(await block.findByRole('alert')).toHaveTextContent('above 0 and up to 24');
      expect(api.count(`POST ${BASE}/tasks/sql1/logs`)).toBe(0);
    });

    it('keeps the entry and the same id when the connection fails, then succeeds on retry', async () => {
      const ids: unknown[] = [];
      let calls = 0;
      open({
        [`POST ${BASE}/tasks/sql1/logs`]: async (request) => {
          ids.push(((await request.json()) as { id: string }).id);
          calls += 1;
          if (calls === 1) throw new TypeError('offline');
          return json(logResult(false), 200);
        },
      });
      const user = userEvent.setup();
      const block = await todaysBlock();
      await user.click(block.getByRole('button', { name: /Log time/ }));
      await user.click(block.getAllByRole('button', { name: 'Log time' }).at(-1)!);
      expect(await block.findByRole('alert')).toHaveTextContent(
        /Can’t reach the server\. Nothing was saved/,
      );
      await user.click(block.getAllByRole('button', { name: 'Log time' }).at(-1)!);
      expect(await screen.findByText(/Logged 1\.5 h/)).toBeInTheDocument();
      expect(ids).toHaveLength(2);
      expect(ids[1]).toBe(ids[0]);
    });

    it('shows the API’s message for a rejected entry', async () => {
      open({
        [`POST ${BASE}/tasks/sql1/logs`]: () =>
          apiError(422, 'unprocessable', 'Hours must be greater than 0.'),
      });
      const user = userEvent.setup();
      const block = await todaysBlock();
      await user.click(block.getByRole('button', { name: /Log time/ }));
      await user.click(block.getAllByRole('button', { name: 'Log time' }).at(-1)!);
      expect(await block.findByRole('alert')).toHaveTextContent('Hours must be greater than 0.');
    });
  });

  describe('finishing a task is always the person’s choice', () => {
    it('asks "Mark as done?" when the estimate is reached and does not complete on its own', async () => {
      const api = open({
        [`POST ${BASE}/tasks/sql1/logs`]: () => json(logResult(true, 2), 201),
        [`POST ${BASE}/tasks/sql1/complete`]: () =>
          json(taskView({ status: 'done', doneHours: 3 })),
      });
      const user = userEvent.setup();
      const block = await todaysBlock();
      await user.click(block.getByRole('button', { name: /Log time/ }));
      await user.click(block.getAllByRole('button', { name: 'Log time' }).at(-1)!);
      const prompt = await screen.findByRole('group', { name: /Estimate reached: Intro to SQL/ });
      expect(prompt).toHaveTextContent("You've reached the estimate. Mark as done?");
      // Give any wrongly automatic call time to happen.
      await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
      expect(api.count(`POST ${BASE}/tasks/sql1/complete`)).toBe(0);
      // The block still offers the normal actions; the prompt is not blocking.
      expect(block.getByRole('button', { name: /Mark done/ })).toBeEnabled();

      await user.click(within(prompt).getByRole('button', { name: 'Mark as done' }));
      expect(await screen.findByText(/Marked Intro to SQL as done/)).toBeInTheDocument();
      expect(api.count(`POST ${BASE}/tasks/sql1/complete`)).toBe(1);
      expect(screen.queryByRole('group', { name: /Estimate reached/ })).not.toBeInTheDocument();
    });

    it('lets the person say "Not yet" without any call', async () => {
      const api = open({ [`POST ${BASE}/tasks/sql1/logs`]: () => json(logResult(true, 2), 201) });
      const user = userEvent.setup();
      const block = await todaysBlock();
      await user.click(block.getByRole('button', { name: /Log time/ }));
      await user.click(block.getAllByRole('button', { name: 'Log time' }).at(-1)!);
      const prompt = await screen.findByRole('group', { name: /Estimate reached/ });
      await user.click(within(prompt).getByRole('button', { name: 'Not yet' }));
      expect(screen.queryByRole('group', { name: /Estimate reached/ })).not.toBeInTheDocument();
      expect(api.count(`POST ${BASE}/tasks/sql1/complete`)).toBe(0);
    });

    it('"Mark done" calls complete only on the click, and Undo reopens', async () => {
      const api = open({
        [`POST ${BASE}/tasks/sql1/complete`]: () => json(taskView({ status: 'done' })),
        [`POST ${BASE}/tasks/sql1/reopen`]: () => json(taskView()),
      });
      const user = userEvent.setup();
      const block = await todaysBlock();
      expect(api.count(`POST ${BASE}/tasks/sql1/complete`)).toBe(0);
      await user.click(block.getByRole('button', { name: /Mark done/ }));
      expect(await screen.findByText(/Marked Intro to SQL as done/)).toBeInTheDocument();
      expect(api.count(`POST ${BASE}/tasks/sql1/complete`)).toBe(1);
      await user.click(screen.getByRole('button', { name: 'Undo' }));
      expect(await screen.findByText(/Reopened Intro to SQL/)).toBeInTheDocument();
      expect(api.count(`POST ${BASE}/tasks/sql1/reopen`)).toBe(1);
    });

    it('"Skip" calls skip only on the click', async () => {
      const api = open({
        [`POST ${BASE}/tasks/sql1/skip`]: () => json(taskView({ status: 'skipped' })),
      });
      const user = userEvent.setup();
      const block = await todaysBlock();
      expect(api.count(`POST ${BASE}/tasks/sql1/skip`)).toBe(0);
      await user.click(block.getByRole('button', { name: /Skip/ }));
      expect(await screen.findByText(/Skipped Intro to SQL/)).toBeInTheDocument();
      // Focus moves to the result, not back to the top of the page.
      expect(document.activeElement).toHaveTextContent(/Skipped Intro to SQL/);
      expect(api.count(`POST ${BASE}/tasks/sql1/skip`)).toBe(1);
      expect(api.count(`POST ${BASE}/tasks/sql1/complete`)).toBe(0);
    });

    it('reports a failed "Mark done" in words', async () => {
      open({
        [`POST ${BASE}/tasks/sql1/complete`]: () =>
          apiError(409, 'conflict', 'The task is already done.'),
      });
      const user = userEvent.setup();
      const block = await todaysBlock();
      await user.click(block.getByRole('button', { name: /Mark done/ }));
      expect(await screen.findByRole('alert')).toHaveTextContent('The task is already done.');
    });
  });

  describe('server problems', () => {
    it('shows an error with Retry when the schedule fails, and recovers', async () => {
      let fail = true;
      open({
        [`GET ${BASE}/schedule`]: () =>
          fail ? apiError(500, 'internal_error', 'boom') : json(schedule()),
      });
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Something went wrong on our side.',
      );
      fail = false;
      await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
      expect(await screen.findByText('Tuesday, Nov 10')).toBeInTheDocument();
    });

    it('says the person is offline instead of spinning forever', async () => {
      onlineManager.setOnline(false);
      open();
      expect(await screen.findByText(/You're offline\./)).toBeInTheDocument();
      await act(async () => onlineManager.setOnline(true));
      expect(await screen.findByText('Tuesday, Nov 10')).toBeInTheDocument();
    });

    it('explains the cold start when the schedule is slow', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      open({ [`GET ${BASE}/schedule`]: () => new Promise<Response>(() => {}) });
      await act(() => vi.advanceTimersByTimeAsync(100));
      expect(await screen.findByText('Loading your schedule…')).toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(3000));
      expect(screen.getByRole('status')).toHaveTextContent(
        'Waking up the server… this can take up to a minute on the free plan',
      );
    });
  });
});
