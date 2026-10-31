import { onlineManager } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { apiError, fakeAuth, installApi, json, renderApp, SESSION } from '../../test/helpers';
import {
  dayState,
  NOW,
  PLAN_ID,
  planRoutes,
  progress,
  schedule,
  taskView,
} from '../../test/plan-fixtures';

afterEach(() => {
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
});

const BASE = `/api/v1/plans/${PLAN_ID}`;
const TODAY = '2026-11-10';

const started = (extra = {}) => dayState({ status: 'started', startedAt: NOW, ...extra });
const ended = () =>
  dayState({
    status: 'ended',
    startedAt: NOW,
    endedAt: NOW,
    frozen: {
      frozenAt: NOW,
      source: 'day_end',
      blocks: schedule().blocks.filter((b) => b.date === TODAY),
    },
  });

function open(extra: Parameters<typeof planRoutes>[0] = {}, path = '/') {
  const api = installApi(planRoutes(extra));
  renderApp({ auth: fakeAuth(SESSION), path });
  return api;
}

/** A day route whose state can be changed by the test, like the server's. */
function statefulDay(initial = dayState()) {
  const state = { current: initial };
  return {
    state,
    routes: {
      [`GET ${BASE}/days/${TODAY}`]: () => json(state.current),
      [`POST ${BASE}/days/${TODAY}/start`]: () => {
        state.current = started();
        return json(state.current, 201);
      },
      [`POST ${BASE}/days/${TODAY}/end`]: () => {
        state.current = ended();
        return json(state.current);
      },
    },
  };
}

describe('Start study day', () => {
  it('shows a prominent button, then the "Day started" state and an End day button', async () => {
    const day = statefulDay();
    const api = open(day.routes);
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Start study day' });
    expect(screen.queryByRole('button', { name: 'End day' })).not.toBeInTheDocument();
    await user.click(button);

    expect(await screen.findByText('Day started')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Day started.');
    expect(screen.queryByRole('button', { name: 'Start study day' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End day' })).toBeEnabled();
    expect(api.count(`POST ${BASE}/days/${TODAY}/start`)).toBe(1);
    // The briefing screen is the next PR: only a clearly named placeholder, no navigation.
    expect(screen.getByText(/day briefing opens here in the next update/i)).toBeInTheDocument();
    // Today stays on screen with its blocks.
    expect(screen.getByRole('heading', { name: 'Today’s blocks' })).toBeInTheDocument();
  });

  it('sends one request on a double click', async () => {
    const day = statefulDay();
    const api = open({
      ...day.routes,
      [`POST ${BASE}/days/${TODAY}/start`]: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        day.state.current = started();
        return json(day.state.current, 201);
      },
    });
    const user = userEvent.setup();
    await user.dblClick(await screen.findByRole('button', { name: 'Start study day' }));
    expect(await screen.findByText('Day started')).toBeInTheDocument();
    expect(api.count(`POST ${BASE}/days/${TODAY}/start`)).toBe(1);
  });

  it('opens an already started day in the started state', async () => {
    open({ [`GET ${BASE}/days/${TODAY}`]: () => json(started()) });
    expect(await screen.findByText('Day started')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start study day' })).not.toBeInTheDocument();
  });

  it('says so and keeps the button when the server refuses, then works on retry', async () => {
    const day = statefulDay();
    let calls = 0;
    open({
      ...day.routes,
      [`POST ${BASE}/days/${TODAY}/start`]: () => {
        calls += 1;
        if (calls === 1) return apiError(422, 'unprocessable', 'A future day cannot be started.');
        day.state.current = started();
        return json(day.state.current, 201);
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Start study day' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A future day cannot be started.');
    await user.click(screen.getByRole('button', { name: 'Start study day' }));
    expect(await screen.findByText('Day started')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says nothing was saved when the connection is lost', async () => {
    open({
      ...statefulDay().routes,
      [`POST ${BASE}/days/${TODAY}/start`]: () => {
        throw new TypeError('offline');
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Start study day' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Can’t reach the server\. Nothing was saved/,
    );
    expect(screen.getByRole('button', { name: 'Start study day' })).toBeEnabled();
  });
});

describe('End day', () => {
  async function openStarted() {
    const day = statefulDay(started());
    const api = open(day.routes);
    const user = userEvent.setup();
    const endButton = await screen.findByRole('button', { name: 'End day' });
    return { api, user, endButton, day };
  }

  it('asks first and explains that the day is frozen and unfinished work moves on', async () => {
    const { api, user, endButton } = await openStarted();
    await user.click(endButton);
    const dialog = screen.getByRole('alertdialog', { name: 'End today?' });
    expect(dialog).toHaveTextContent('freezes it');
    expect(dialog).toHaveTextContent('moves to the next study day');
    // Focus starts on the safe answer.
    expect(within(dialog).getByRole('button', { name: 'Keep working' })).toHaveFocus();
    expect(api.count(`POST ${BASE}/days/${TODAY}/end`)).toBe(0);
  });

  it('closes on Cancel and on Escape without calling the API, and returns focus', async () => {
    const { api, user, endButton } = await openStarted();
    await user.click(endButton);
    await user.click(screen.getByRole('button', { name: 'Keep working' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(endButton).toHaveFocus();

    await user.click(endButton);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(endButton).toHaveFocus();
    expect(api.count(`POST ${BASE}/days/${TODAY}/end`)).toBe(0);
  });

  it('keeps Tab inside the dialog', async () => {
    const { user, endButton } = await openStarted();
    await user.click(endButton);
    const dialog = within(screen.getByRole('alertdialog'));
    expect(dialog.getByRole('button', { name: 'Keep working' })).toHaveFocus();
    await user.tab();
    expect(dialog.getByRole('button', { name: 'End day' })).toHaveFocus();
    await user.tab();
    expect(dialog.getByRole('button', { name: 'Keep working' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(dialog.getByRole('button', { name: 'End day' })).toHaveFocus();
  });

  it('ends the day once, shows "Day ended" and the review placeholder, and refreshes the schedule', async () => {
    const { api, user, endButton } = await openStarted();
    const schedulesBefore = api.count(`GET ${BASE}/schedule`);
    await user.click(endButton);
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'End day' }),
    );

    expect(await screen.findByText('Day ended')).toBeInTheDocument();
    expect(screen.getByText(/This day is frozen/)).toBeInTheDocument();
    expect(
      screen.getByText(/end-of-day review opens here in the next update/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End day' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start study day' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Day ended.');
    expect(api.count(`POST ${BASE}/days/${TODAY}/end`)).toBe(1);
    await waitFor(() => expect(api.count(`GET ${BASE}/schedule`)).toBeGreaterThan(schedulesBefore));
  });

  it('sends one request on a double click of the confirm button', async () => {
    const day = statefulDay(started());
    const api = open({
      ...day.routes,
      [`POST ${BASE}/days/${TODAY}/end`]: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        day.state.current = ended();
        return json(day.state.current);
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'End day' }));
    await user.dblClick(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'End day' }),
    );
    expect(await screen.findByText('Day ended')).toBeInTheDocument();
    expect(api.count(`POST ${BASE}/days/${TODAY}/end`)).toBe(1);
  });

  it('reports a failure and leaves the day open', async () => {
    const day = statefulDay(started());
    open({
      ...day.routes,
      [`POST ${BASE}/days/${TODAY}/end`]: () => {
        throw new TypeError('offline');
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'End day' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'End day' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/Nothing was saved/);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText('Day started')).toBeInTheDocument();
  });

  it('shows an ended day without Start or End buttons, its frozen blocks still listed', async () => {
    open({ [`GET ${BASE}/days/${TODAY}`]: () => json(ended()) });
    expect(await screen.findByText('Day ended')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /End day|Start study day/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Intro to SQL' })).toBeInTheDocument();
  });
});

describe('Today’s hours and tasks', () => {
  it('shows planned, completed and remaining hours for today', async () => {
    // 1.5 h still scheduled + 0.5 h logged today = 2 h planned.
    open({
      [`GET ${BASE}/progress`]: () =>
        json(progress({ byDay: [{ date: TODAY, hours: 0.5, entries: 1 }] })),
    });
    const hours = await screen.findByRole('region', { name: 'Today’s hours' });
    const text = (term: string) => within(hours).getByText(term).nextElementSibling;
    await waitFor(() => expect(text('Planned')).toHaveTextContent('2 h'));
    expect(text('Completed')).toHaveTextContent('0.5 h');
    expect(text('Remaining')).toHaveTextContent('1.5 h');
    expect(within(hours).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  });

  it('lists a task that was worked on today but has no block left, with its status and hours', async () => {
    open({
      [`GET ${BASE}/schedule`]: () => json(schedule({ blocks: [] })),
      [`GET ${BASE}/logs`]: () =>
        json({
          logs: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              planId: PLAN_ID,
              taskId: 'setup',
              date: TODAY,
              hours: 0.5,
              createdAt: NOW,
            },
          ],
        }),
    });
    const section = (await screen.findByRole('heading', { name: 'Worked on today' })).closest(
      'section',
    ) as HTMLElement;
    expect(within(section).getByText('Set up accounts')).toBeInTheDocument();
    expect(within(section).getByText('Done')).toBeInTheDocument();
    expect(
      within(section).getByText(/Today 0\.5 h · Estimated 0\.5 h · Actual 0\.5 h/),
    ).toBeInTheDocument();
    // Reopening is the person's choice; nothing is called on its own.
    expect(within(section).getByRole('button', { name: /Reopen/ })).toBeInTheDocument();
  });

  it('offers only Reopen on a finished task', async () => {
    open({
      [`GET ${BASE}/tasks`]: () =>
        json({ tasks: [taskView({ id: 'sql1', status: 'done', doneHours: 3 })] }),
    });
    const heading = await screen.findByRole('heading', { name: 'Today’s blocks' });
    const item = within(
      within(heading.closest('section') as HTMLElement).getAllByRole('listitem')[0]!,
    );
    expect(item.getByText('Done')).toBeInTheDocument();
    expect(item.getByRole('button', { name: /Reopen/ })).toBeInTheDocument();
    expect(item.queryByRole('button', { name: /Mark done/ })).not.toBeInTheDocument();
  });
});

describe('Past and future days', () => {
  const YESTERDAY = '2026-11-09';
  const pastRoutes = {
    [`GET ${BASE}/days/${YESTERDAY}`]: () =>
      json(
        dayState({
          date: YESTERDAY,
          status: 'ended',
          startedAt: NOW,
          endedAt: NOW,
          frozen: {
            frozenAt: NOW,
            source: 'day_end',
            blocks: [
              {
                taskId: 'setup',
                date: YESTERDAY,
                start: '09:00',
                end: '09:30',
                minutes: 30,
                kind: 'study',
              },
            ],
          },
        }),
      ),
  };

  it('goes back one day with Previous day and shows the frozen blocks read-only', async () => {
    const api = open(pastRoutes);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Previous day' }));
    expect(await screen.findByText('Monday, Nov 9')).toBeInTheDocument();
    expect(await screen.findByText(/frozen, read-only/)).toBeInTheDocument();
    const list = screen.getByRole('heading', { name: 'Planned blocks' }).closest('section')!;
    expect(within(list).getByText('Set up accounts')).toBeInTheDocument();
    expect(within(list).getByText('09:00–09:30')).toBeInTheDocument();
    // Nothing can be changed on a past day.
    expect(
      screen.queryByRole('button', { name: /Start study day|End day|Log time|Mark done/ }),
    ).toBeNull();
    expect(api.count(`POST ${BASE}/days/${YESTERDAY}/start`)).toBe(0);
    // And back to today.
    await user.click(screen.getByRole('button', { name: 'Back to today' }));
    expect(await screen.findByRole('button', { name: 'Start study day' })).toBeInTheDocument();
  });

  it('opens a past day from the address and enables Next day there', async () => {
    open(pastRoutes, `/?date=${YESTERDAY}`);
    expect(await screen.findByText('Monday, Nov 9')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next day' })).toBeEnabled();
  });

  it('cannot go past today: Next day is disabled on today and the date field stops at today', async () => {
    open();
    expect(await screen.findByRole('button', { name: 'Next day' })).toBeDisabled();
    const field = screen.getByLabelText('Go to day');
    expect(field).toHaveAttribute('max', TODAY);
    expect(field).toHaveAttribute('min', '2026-11-03');
  });

  it('does not open a future day typed into the address: no day request, no Start button', async () => {
    const api = open({}, '/?date=2026-11-12');
    expect(await screen.findByText(/has not arrived yet/)).toBeInTheDocument();
    expect(api.count(`GET ${BASE}/days/2026-11-12`)).toBe(0);
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();
    // The day shown is today's, so the start button belongs to today and not to the future date.
    expect(screen.getByText('Tuesday, Nov 10')).toBeInTheDocument();
  });

  it('treats a malformed date in the address as today', async () => {
    open({}, '/?date=not-a-date');
    expect(await screen.findByText('Tuesday, Nov 10')).toBeInTheDocument();
  });

  it('says nothing was recorded for a day without a snapshot', async () => {
    open(
      { [`GET ${BASE}/days/${YESTERDAY}`]: () => json(dayState({ date: YESTERDAY })) },
      `/?date=${YESTERDAY}`,
    );
    expect(await screen.findByText('Nothing was recorded for this day.')).toBeInTheDocument();
  });
});

describe('Today: errors and accessibility', () => {
  it('shows the problem with Retry when the day cannot be loaded, and the blocks still show', async () => {
    let calls = 0;
    open({
      [`GET ${BASE}/days/${TODAY}`]: () => {
        calls += 1;
        return calls === 1 ? apiError(500, 'internal', 'boom') : json(dayState());
      },
    });
    expect(await screen.findByText('Something went wrong on our side.')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Start study day' })).toBeInTheDocument();
  });

  it('says the person is offline, then recovers', async () => {
    onlineManager.setOnline(false);
    open();
    expect(await screen.findByText(/You're offline\./)).toBeInTheDocument();
    await act(async () => onlineManager.setOnline(true));
    expect(await screen.findByRole('button', { name: 'Start study day' })).toBeInTheDocument();
  });

  it('has no accessibility violations in the three day states and with the dialog open', async () => {
    const day = statefulDay();
    open(day.routes);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Start study day' }));
    await screen.findByText('Day started');
    await expectNoAxeViolations();
    await user.click(screen.getByRole('button', { name: 'End day' }));
    await expectNoAxeViolations();
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'End day' }),
    );
    await screen.findByText('Day ended');
    await expectNoAxeViolations();
  });

  it('has no accessibility violations on a past day', async () => {
    open(
      { [`GET ${BASE}/days/2026-11-09`]: () => json(dayState({ date: '2026-11-09' })) },
      '/?date=2026-11-09',
    );
    await screen.findByText('Nothing was recorded for this day.');
    await expectNoAxeViolations();
  });
});
