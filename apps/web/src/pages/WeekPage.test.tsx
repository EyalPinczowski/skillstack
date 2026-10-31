import { onlineManager } from '@tanstack/react-query';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { apiError, fakeAuth, installApi, json, renderApp, SESSION } from '../test/helpers';
import {
  anchorAtRisk,
  openTasks,
  PLAN_ID,
  planRoutes,
  progress,
  schedule,
} from '../test/plan-fixtures';

afterEach(() => {
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
});

const BASE = `/api/v1/plans/${PLAN_ID}`;

// Week of Sun Nov 8 to Sat Nov 14, today Tue Nov 10. Monday is frozen: 2 h planned, 2 h done.
const block = (taskId: string, date: string, minutes: number) => ({
  taskId,
  date,
  start: '09:00',
  end: '10:00',
  minutes,
  kind: 'study' as const,
});
const weekBlocks = [
  block('setup', '2026-11-09', 30),
  block('sql1', '2026-11-09', 90),
  block('sql1', '2026-11-10', 90),
  block('sql1', '2026-11-11', 120),
  block('exam', '2026-11-19', 60),
];
const weekRoutes = {
  [`GET ${BASE}/schedule`]: () => json(schedule({ blocks: weekBlocks })),
  [`GET ${BASE}/progress`]: () =>
    json(
      progress({
        byDay: [
          { date: '2026-11-09', hours: 2, entries: 2 },
          { date: '2026-11-10', hours: 0.5, entries: 1 },
        ],
      }),
    ),
  [`GET ${BASE}/open-tasks`]: () =>
    json(
      openTasks({
        tasks: [
          {
            taskId: 'exam',
            title: 'SQL exam',
            type: 'cert_exam',
            status: 'pending',
            estHours: 1,
            doneHours: 0,
            remainingHours: 1,
            plannedDates: ['2026-11-12'],
            carriedOverFrom: [],
          },
          {
            taskId: 'sql1',
            title: 'Intro to SQL',
            type: 'course',
            status: 'in_progress',
            estHours: 3,
            doneHours: 1,
            remainingHours: 2,
            plannedDates: ['2026-11-10', '2026-11-11'],
            carriedOverFrom: ['2026-11-05', '2026-11-09'],
          },
        ],
      }),
    ),
};

function open(extra: Parameters<typeof planRoutes>[0] = {}, path = '/week') {
  const api = installApi(planRoutes({ ...weekRoutes, ...extra }));
  renderApp({ auth: fakeAuth(SESSION), path });
  return api;
}

describe('Week', () => {
  it('is in the main navigation', async () => {
    open();
    await screen.findByRole('heading', { name: 'Week' });
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Today', 'Week', 'Plan', 'Settings']);
    expect(within(nav).getByRole('link', { name: 'Week' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows the week’s tasks completed and actual against planned hours', async () => {
    open();
    const section = (await screen.findByRole('heading', { name: 'Week progress' })).closest(
      'section',
    ) as HTMLElement;
    expect(within(section).getByText('Tasks completed').nextElementSibling).toHaveTextContent(
      '1 of 2',
    );
    // Planned: Mon 2 + Tue (1.5 left + 0.5 logged) 2 + Wed 2 = 6 h. Actual: 2 + 0.5.
    expect(
      within(section).getByText(/Hours, actual of planned/).nextElementSibling,
    ).toHaveTextContent('2.5 h of 6 h');
  });

  it('draws a chart with a text alternative and a table with the same numbers', async () => {
    open();
    const chart = await screen.findByRole('img', { name: /Mon: 2 h done of 2 h planned/ });
    expect(chart).toHaveAccessibleName(/Tue: 0.5 h done of 2 h planned/);
    // Real hour values are printed as text, not only as bar heights.
    const legend = within(chart.closest('figure')!.querySelector('figcaption')!);
    expect(legend.getByText('Planned')).toBeInTheDocument();
    expect(legend.getByText('Actual')).toBeInTheDocument();
    // The chart is built from plain elements: no gradient anywhere.
    expect(chart.outerHTML).not.toMatch(/gradient/i);
    const user = userEvent.setup();
    await user.click(screen.getByText('Show the numbers as a table'));
    const table = screen.getByRole('table', { name: /Planned and actual hours per day/ });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(8);
    expect(
      within(rows[3]!)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['2 h', '0.5 h']);
    expect(within(rows[3]!).getByRole('rowheader')).toHaveTextContent('Tue, Nov 10 (today)');
  });

  it('marks tasks carried over from earlier days with words and an icon', async () => {
    open();
    const heading = await screen.findByRole('heading', { name: 'Open tasks' });
    const rows = within(heading.closest('section') as HTMLElement).getAllByRole('listitem');
    // Carried-over tasks come first.
    expect(within(rows[0]!).getByRole('link', { name: 'Intro to SQL' })).toHaveAttribute(
      'href',
      '/plan/sql1',
    );
    const marker = within(rows[0]!).getByText('Carried over from Nov 5, Mon');
    expect(marker.querySelector('svg')).not.toBeNull();
    expect(within(rows[0]!).getByText('2 h left')).toBeInTheDocument();
    // A task that is only planned ahead has no marker.
    expect(within(rows[1]!).getByRole('link', { name: 'SQL exam' })).toBeInTheDocument();
    expect(within(rows[1]!).queryByText(/Carried over/)).not.toBeInTheDocument();
    expect(within(rows[1]!).getByText('Planned Thu')).toBeInTheDocument();
  });

  it('says when nothing is open', async () => {
    open({ [`GET ${BASE}/open-tasks`]: () => json(openTasks()) });
    expect(await screen.findByText('Nothing is open this week.')).toBeInTheDocument();
  });

  describe('trend', () => {
    // The fixture plan ends on 2026-11-26.
    it.each([
      ['2026-11-20', 'Ahead of plan by 6 days'],
      ['2026-11-25', 'Ahead of plan by 1 day'],
      ['2026-11-26', 'On track'],
      ['2026-11-27', 'Behind plan by 1 day'],
      ['2026-12-01', 'Behind plan by 5 days'],
    ])('a projected finish of %s reads "%s" with the projected date', async (finish, label) => {
      open({
        [`GET ${BASE}/schedule`]: () => json(schedule({ blocks: weekBlocks, finishDate: finish })),
      });
      const section = (await screen.findByRole('heading', { name: 'Trend' })).closest(
        'section',
      ) as HTMLElement;
      expect(within(section).getByText(label)).toBeInTheDocument();
      // An icon next to the words, so the colour is never the only signal.
      expect(within(section).getByText(label).querySelector('svg')).not.toBeNull();
      expect(section).toHaveTextContent('Projected finish');
      expect(section).toHaveTextContent('Plan end Thu, Nov 26');
    });

    it('is unavailable, in words, when there is no finish date', async () => {
      open({
        [`GET ${BASE}/schedule`]: () => json(schedule({ blocks: weekBlocks, finishDate: null })),
      });
      const section = (await screen.findByRole('heading', { name: 'Trend' })).closest(
        'section',
      ) as HTMLElement;
      expect(section).toHaveTextContent('Trend not available');
      expect(section).toHaveTextContent('There is no projected finish date yet.');
    });
  });

  describe('plan summary bar', () => {
    it('shows overall progress and certificates earned of total on every plan page', async () => {
      for (const path of ['/week', '/plan', '/']) {
        const api = installApi(planRoutes(weekRoutes));
        const view = renderApp({ auth: fakeAuth(SESSION), path });
        const bar = await screen.findByRole('region', { name: 'Plan summary' });
        expect(
          await within(bar).findByRole('progressbar', { name: 'Plan progress' }),
        ).toHaveAttribute('aria-valuenow', '33');
        expect(bar).toHaveTextContent('1.5 h done of 4.5 h planned');
        expect(bar).toHaveTextContent('Certificates 0 of 1');
        expect(api.count(`GET ${BASE}/progress`)).toBe(1);
        view.unmount();
        vi.unstubAllGlobals();
      }
    });

    it('is not shown on Settings', async () => {
      open({}, '/settings');
      await screen.findByRole('heading', { name: 'Settings' });
      expect(screen.queryByRole('region', { name: 'Plan summary' })).not.toBeInTheDocument();
    });

    it('pins an exam-at-risk warning, in words with an icon, linking to the Plan page', async () => {
      open({
        [`GET ${BASE}/schedule`]: () =>
          json(schedule({ blocks: weekBlocks, warnings: [anchorAtRisk] })),
      });
      const warning = await screen.findByRole('group', { name: 'Exam at risk' });
      expect(warning).toHaveTextContent('Exam at risk: SQL exam, Thu, Nov 19 at 10:00');
      expect(warning.querySelector('svg')).not.toBeNull();
      expect(within(warning).getByRole('link', { name: 'See the plan' })).toHaveAttribute(
        'href',
        '/plan',
      );
      // Pinned: it sits in the sticky summary bar at the top of the page.
      const bar = screen.getByRole('region', { name: 'Plan summary' });
      expect(bar).toContainElement(warning);
      expect(bar.className).toContain('sticky');
      expect(bar.className).toContain('top-0');
    });

    it('shows no warning when the schedule has none', async () => {
      open();
      await screen.findByRole('region', { name: 'Plan summary' });
      expect(screen.queryByRole('group', { name: 'Exam at risk' })).not.toBeInTheDocument();
    });

    it('navigates to the Plan page from the warning', async () => {
      open({
        [`GET ${BASE}/schedule`]: () =>
          json(schedule({ blocks: weekBlocks, warnings: [anchorAtRisk] })),
      });
      const user = userEvent.setup();
      await user.click(await screen.findByRole('link', { name: 'See the plan' }));
      expect(await screen.findByRole('heading', { name: 'Plan' })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Exam at risk' })).toBeInTheDocument();
    });

    it('says the summary is unavailable when progress cannot be loaded', async () => {
      open({ [`GET ${BASE}/progress`]: () => apiError(500, 'internal', 'boom') });
      expect(
        await screen.findByText('Progress summary is not available right now.'),
      ).toBeInTheDocument();
    });
  });

  describe('errors and accessibility', () => {
    it('has no accessibility violations', async () => {
      open({
        [`GET ${BASE}/schedule`]: () =>
          json(schedule({ blocks: weekBlocks, warnings: [anchorAtRisk] })),
      });
      await screen.findByRole('heading', { name: 'Open tasks' });
      await screen.findByRole('img', { name: /Mon:/ });
      await expectNoAxeViolations();
      const user = userEvent.setup();
      await user.click(screen.getByText('Show the numbers as a table'));
      await expectNoAxeViolations();
    });

    it('shows the problem with Retry when the open tasks cannot be loaded', async () => {
      let calls = 0;
      open({
        [`GET ${BASE}/open-tasks`]: () => {
          calls += 1;
          return calls === 1 ? apiError(500, 'internal', 'boom') : json(openTasks());
        },
      });
      expect(await screen.findByText('Something went wrong on our side.')).toBeInTheDocument();
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Retry' }));
      expect(await screen.findByText('Nothing is open this week.')).toBeInTheDocument();
    });

    it('says the person is offline, then recovers', async () => {
      onlineManager.setOnline(false);
      open();
      expect(await screen.findByText(/You're offline\./)).toBeInTheDocument();
      await act(async () => onlineManager.setOnline(true));
      expect(await screen.findByRole('heading', { name: 'Open tasks' })).toBeInTheDocument();
    });

    it('says there is no plan yet', async () => {
      installApi({ ...planRoutes(), 'GET /api/v1/plans': () => json({ plans: [] }) });
      renderApp({ auth: fakeAuth(SESSION), path: '/week' });
      expect(await screen.findByText(/No plan yet/)).toBeInTheDocument();
    });
  });
});
