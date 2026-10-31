import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeAuth, installApi, json, renderApp, SESSION } from '../../test/helpers';
import { NOW, PLAN_ID, planRoutes, schedule, taskView } from '../../test/plan-fixtures';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const BASE = `/api/v1/plans/${PLAN_ID}`;
const SCHEDULE = `GET ${BASE}/schedule`;

/**
 * A server whose "today" is the date in `timezone` at the fake clock's time, like the real one
 * (the API computes it in the plan's zone). Blocks are always for that day.
 */
function open(timezone: string, today: () => string, extra: Parameters<typeof planRoutes>[0] = {}) {
  const api = installApi(
    planRoutes({
      [SCHEDULE]: () =>
        json(
          schedule({
            timezone,
            today: today(),
            blocks: [
              {
                taskId: 'sql1',
                date: today(),
                start: '09:00',
                end: '10:30',
                minutes: 90,
                kind: 'study',
              },
            ],
          }),
        ),
      ...extra,
    }),
  );
  renderApp({ auth: fakeAuth(SESSION), path: '/' });
  return api;
}

// Asia/Jerusalem is UTC+2 on these dates: its midnight is 22:00 UTC.
const jerusalemToday = () =>
  Date.now() >= Date.parse('2026-11-10T22:00:00Z') ? '2026-11-11' : '2026-11-10';
// America/New_York is UTC-5: its midnight is 05:00 UTC.
const newYorkToday = () =>
  Date.now() >= Date.parse('2026-11-11T05:00:00Z') ? '2026-11-11' : '2026-11-10';

const start = (iso: string) => vi.useFakeTimers({ shouldAdvanceTime: true, now: Date.parse(iso) });
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const MINUTE = 60_000;

describe('midnight rollover (v0.1 review finding 8)', () => {
  it('refreshes Today at midnight in the plan’s time zone while the page stays open', async () => {
    start('2026-11-10T21:55:00Z'); // 23:55 in Jerusalem
    const api = open('Asia/Jerusalem', jerusalemToday);
    expect(await screen.findByText('Tuesday, Nov 10')).toBeInTheDocument();
    expect(api.count(SCHEDULE)).toBe(1);

    await advance(4 * MINUTE); // 23:59
    expect(api.count(SCHEDULE)).toBe(1);
    await advance(2 * MINUTE); // 00:01 on Nov 11
    expect(await screen.findByText('Wednesday, Nov 11')).toBeInTheDocument();
    expect(api.count(SCHEDULE)).toBe(2);
    expect(screen.queryByText('Tuesday, Nov 10')).not.toBeInTheDocument();
  });

  it('follows the plan’s zone, not UTC: UTC midnight in New York is only early evening', async () => {
    start('2026-11-10T23:50:00Z'); // 18:50 in New York
    const api = open('America/New_York', newYorkToday);
    expect(await screen.findByText('Tuesday, Nov 10')).toBeInTheDocument();
    await advance(20 * MINUTE); // 00:10 UTC on Nov 11, 19:10 in New York
    expect(api.count(SCHEDULE)).toBe(1);
    expect(screen.getByText('Tuesday, Nov 10')).toBeInTheDocument();

    // New York's own midnight is at 05:00 UTC.
    await advance(5 * 60 * MINUTE);
    expect(await screen.findByText('Wednesday, Nov 11')).toBeInTheDocument();
    expect(api.count(SCHEDULE)).toBe(2);
  });

  it('refreshes when the window gets focus after the device slept past midnight', async () => {
    start('2026-11-10T21:55:00Z');
    const api = open('Asia/Jerusalem', jerusalemToday);
    await screen.findByText('Tuesday, Nov 10');

    // The tablet slept: no timer ran, the clock simply jumped to the next morning.
    vi.setSystemTime(Date.parse('2026-11-11T05:00:00Z'));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(await screen.findByText('Wednesday, Nov 11')).toBeInTheDocument();
    expect(api.count(SCHEDULE)).toBe(2);
  });

  it('refreshes when the tab becomes visible again after midnight', async () => {
    start('2026-11-10T21:55:00Z');
    const api = open('Asia/Jerusalem', jerusalemToday);
    await screen.findByText('Tuesday, Nov 10');
    vi.setSystemTime(Date.parse('2026-11-11T05:00:00Z'));
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await screen.findByText('Wednesday, Nov 11')).toBeInTheDocument();
    expect(api.count(SCHEDULE)).toBe(2);
  });

  it('does not refetch on focus when it is still the same day', async () => {
    start('2026-11-10T09:00:00Z');
    const api = open('Asia/Jerusalem', jerusalemToday);
    await screen.findByText('Tuesday, Nov 10');
    vi.setSystemTime(Date.parse('2026-11-10T20:00:00Z')); // 22:00, still Nov 10
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(api.count(SCHEDULE)).toBe(1);
  });

  it('logs time against the new day after the rollover, not the old one', async () => {
    start('2026-11-10T21:55:00Z');
    let logged: Record<string, unknown> = {};
    open('Asia/Jerusalem', jerusalemToday, {
      [`POST ${BASE}/tasks/sql1/logs`]: async (request) => {
        logged = (await request.json()) as Record<string, unknown>;
        return json(
          {
            log: {
              id: '33333333-3333-4333-8333-333333333333',
              planId: PLAN_ID,
              taskId: 'sql1',
              date: '2026-11-11',
              hours: 1.5,
              createdAt: NOW,
            },
            task: taskView({ doneHours: 2.5 }),
            suggestDone: false,
          },
          201,
        );
      },
    });
    await screen.findByText('Tuesday, Nov 10');
    vi.setSystemTime(Date.parse('2026-11-10T22:30:00Z'));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await screen.findByText('Wednesday, Nov 11');

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const heading = await screen.findByRole('heading', { name: 'Today’s blocks' });
    const block = within(within(heading.closest('section')!).getAllByRole('listitem')[0]!);
    await user.click(block.getByRole('button', { name: /Log time/ }));
    await user.click(block.getAllByRole('button', { name: 'Log time' }).at(-1)!);
    expect(await screen.findByText(/Logged 1\.5 h on Intro to SQL/)).toBeInTheDocument();
    expect(logged).toMatchObject({ date: '2026-11-11' });
  });

  it('stops listening when the page is left', async () => {
    start('2026-11-10T21:55:00Z');
    const api = open('Asia/Jerusalem', jerusalemToday);
    await screen.findByText('Tuesday, Nov 10');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole('link', { name: /Settings/ }));
    await screen.findByRole('heading', { name: 'Settings' });
    const before = api.count(SCHEDULE);
    vi.setSystemTime(Date.parse('2026-11-11T05:00:00Z'));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await advance(10 * MINUTE);
    expect(api.count(SCHEDULE)).toBe(before);
  });
});
