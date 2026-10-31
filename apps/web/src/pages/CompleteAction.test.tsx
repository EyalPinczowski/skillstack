import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../api/client';
import { expectNoAxeViolations } from '../test/axe';
import { fakeAuth, installApi, json, renderApp, SESSION } from '../test/helpers';
import { NOW, PLAN_ID, planRoutes, schedule, TASKS, taskView } from '../test/plan-fixtures';

afterEach(() => vi.unstubAllGlobals());

const BASE = `/api/v1/plans/${PLAN_ID}`;
const TODAY = '2026-11-10';

const todaysLog = {
  id: '33333333-3333-4333-8333-333333333333',
  planId: PLAN_ID,
  taskId: 'sql1',
  date: TODAY,
  hours: 2,
  createdAt: NOW,
};

/**
 * sql1 has logged its full estimate and no block left today. Its status changes like the
 * server's when the action routes are called.
 */
function open(path: string, status: Task['status'], extra: Parameters<typeof planRoutes>[0] = {}) {
  const state = { status };
  const sql = () => taskView({ status: state.status, doneHours: 3 });
  // The list is slow to refresh after an action, like a real server, so a second click can land
  // after the action answered but before the buttons change.
  const slow = () => new Promise((resolve) => setTimeout(resolve, 60));
  const move = (to: Task['status']) => () => {
    state.status = to;
    return json(sql());
  };
  const api = installApi(
    planRoutes({
      [`GET ${BASE}/tasks`]: async () => {
        if (state.status !== status) await slow();
        return json({ tasks: TASKS.map((t) => (t.id === 'sql1' ? sql() : t)) });
      },
      [`GET ${BASE}/schedule`]: () =>
        json(schedule({ blocks: schedule().blocks.filter((b) => b.taskId !== 'sql1') })),
      [`GET ${BASE}/logs`]: () => json({ logs: [todaysLog] }),
      [`POST ${BASE}/tasks/sql1/complete`]: move('done'),
      [`POST ${BASE}/tasks/sql1/skip`]: move('skipped'),
      [`POST ${BASE}/tasks/sql1/reopen`]: move('in_progress'),
      ...extra,
    }),
  );
  renderApp({ auth: fakeAuth(SESSION), path });
  return api;
}

async function workedOnCard() {
  const heading = await screen.findByRole('heading', { name: 'Worked on today' });
  return within(heading.closest('section') as HTMLElement);
}

describe('Task page actions by status', () => {
  it.each(['pending', 'in_progress'] as const)(
    'offers Log time, Mark done and Skip when %s',
    async (status) => {
      open('/plan/sql1', status);
      await screen.findByRole('heading', { level: 1, name: 'Intro to SQL' });
      for (const name of [/^Log time/, /^Mark done/, /^Skip/]) {
        expect(await screen.findByRole('button', { name })).toBeEnabled();
      }
      expect(screen.queryByRole('button', { name: /Reopen/ })).not.toBeInTheDocument();
    },
  );

  it.each(['done', 'skipped'] as const)('offers only Reopen when %s', async (status) => {
    open('/plan/sql1', status);
    expect(await screen.findByRole('button', { name: /Reopen/ })).toBeEnabled();
    for (const name of [/^Log time/, /^Mark done/, /^Skip/]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('marks done on click only, announces it, and then offers Reopen', async () => {
    const api = open('/plan/sql1', 'in_progress');
    const user = userEvent.setup();
    const done = await screen.findByRole('button', { name: /^Mark done/ });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(api.count(`POST ${BASE}/tasks/sql1/complete`)).toBe(0);
    await user.click(done);
    expect(await screen.findByText(/Marked Intro to SQL as done/)).toBeInTheDocument();
    expect(document.activeElement).toHaveTextContent(/Marked Intro to SQL as done/);
    expect(await screen.findByRole('button', { name: /Reopen/ })).toBeInTheDocument();
    expect(api.count(`POST ${BASE}/tasks/sql1/complete`)).toBe(1);
  });

  it('skips on click and reopens on click', async () => {
    const api = open('/plan/sql1', 'in_progress');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^Skip/ }));
    expect(await screen.findByText(/Skipped Intro to SQL/)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Reopen/ }));
    expect(await screen.findByText(/Reopened Intro to SQL/)).toBeInTheDocument();
    expect(api.count(`POST ${BASE}/tasks/sql1/skip`)).toBe(1);
    expect(api.count(`POST ${BASE}/tasks/sql1/reopen`)).toBe(1);
  });

  it('sends one call for a double click', async () => {
    const api = open('/plan/sql1', 'in_progress');
    const user = userEvent.setup();
    await user.dblClick(await screen.findByRole('button', { name: /^Mark done/ }));
    await screen.findByText(/Marked Intro to SQL as done/);
    expect(api.count(`POST ${BASE}/tasks/sql1/complete`)).toBe(1);
  });

  it('opens the log form from the page', async () => {
    open('/plan/sql1', 'in_progress');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^Log time/ }));
    expect(await screen.findByRole('spinbutton', { name: 'Hours' })).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    open('/plan/sql1', 'in_progress');
    await screen.findByRole('button', { name: /^Mark done/ });
    await expectNoAxeViolations();
  });
});

describe('Worked on today card', () => {
  it('offers Log time, Mark done and Skip for an in-progress task', async () => {
    open('/', 'in_progress');
    const card = await workedOnCard();
    for (const name of [/^Log time/, /^Mark done/, /^Skip/]) {
      expect(card.getByRole('button', { name })).toBeEnabled();
    }
    expect(card.queryByRole('button', { name: /Reopen/ })).not.toBeInTheDocument();
  });

  it.each(['done', 'skipped'] as const)('offers only Reopen when %s', async (status) => {
    open('/', status);
    const card = await workedOnCard();
    expect(card.getByRole('button', { name: /Reopen/ })).toBeEnabled();
    for (const name of [/^Log time/, /^Mark done/, /^Skip/]) {
      expect(card.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('marks done on click only and sends one call for a double click', async () => {
    const api = open('/', 'in_progress');
    const user = userEvent.setup();
    const card = await workedOnCard();
    expect(api.count(`POST ${BASE}/tasks/sql1/complete`)).toBe(0);
    await user.dblClick(card.getByRole('button', { name: /^Mark done/ }));
    expect(await screen.findByText(/Marked Intro to SQL as done/)).toBeInTheDocument();
    expect(api.count(`POST ${BASE}/tasks/sql1/complete`)).toBe(1);
    expect(
      await (await workedOnCard()).findByRole('button', { name: /Reopen/ }),
    ).toBeInTheDocument();
  });

  it('skips on click', async () => {
    const api = open('/', 'in_progress');
    const user = userEvent.setup();
    await user.click((await workedOnCard()).getByRole('button', { name: /^Skip/ }));
    expect(await screen.findByText(/Skipped Intro to SQL/)).toBeInTheDocument();
    expect(api.count(`POST ${BASE}/tasks/sql1/skip`)).toBe(1);
  });

  it('keeps the actions after the estimate prompt is dismissed with "Not yet"', async () => {
    const api = open('/', 'in_progress', {
      [`POST ${BASE}/tasks/sql1/logs`]: () =>
        json({ log: todaysLog, task: taskView({ doneHours: 3 }), suggestDone: true }, 201),
    });
    const user = userEvent.setup();
    const card = await workedOnCard();
    await user.click(card.getByRole('button', { name: /^Log time/ }));
    await user.click(card.getAllByRole('button', { name: 'Log time' }).at(-1)!);
    const prompt = await screen.findByRole('group', { name: /Estimate reached/ });
    await user.click(within(prompt).getByRole('button', { name: 'Not yet' }));
    expect(screen.queryByRole('group', { name: /Estimate reached/ })).not.toBeInTheDocument();
    expect(api.count(`POST ${BASE}/tasks/sql1/complete`)).toBe(0);
    const after = await workedOnCard();
    expect(after.getByRole('button', { name: /^Mark done/ })).toBeEnabled();
    expect(after.getByRole('button', { name: /^Skip/ })).toBeEnabled();
  });

  it('has no accessibility violations', async () => {
    open('/', 'in_progress');
    await workedOnCard();
    await expectNoAxeViolations();
  });
});
