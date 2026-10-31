import { onlineManager } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BASE, briefingBody, DATE, dayRoutes, dayState } from '../../test/day-fixtures';
import { expectNoAxeViolations } from '../../test/axe';
import { apiError, fakeAuth, installApi, json, renderApp, SESSION } from '../../test/helpers';

afterEach(() => {
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'execCommand');
});

const BRIEFING = `GET ${BASE}/days/${DATE}/briefing`;
const START = `POST ${BASE}/days/${DATE}/start`;

function open(extra: Parameters<typeof dayRoutes>[0] = {}) {
  const api = installApi(dayRoutes(extra));
  renderApp({ auth: fakeAuth(SESSION), path: `/briefing/${DATE}` });
  return api;
}

async function taskCard(title: string) {
  const heading = await screen.findByRole('heading', { name: title, level: 3 });
  return within(heading.closest('article') as HTMLElement);
}

describe('Day briefing', () => {
  it('shows the overview, the suggested order and each task with type, time and what it covers', async () => {
    open();
    expect(await screen.findByText(/Today is 4 hours of study/)).toBeInTheDocument();

    const order = screen.getByRole('heading', { name: 'Suggested order' }).closest('section')!;
    const items = within(order).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('09:00–10:30 Intro to SQL');
    expect(items[1]).toHaveTextContent('14:00–15:30 Mock interview');

    const course = await taskCard('Intro to SQL');
    expect(course.getByText('Course')).toBeInTheDocument();
    expect(course.getByText('09:00–12:30')).toBeInTheDocument();
    expect(course.getByText(/2 h 30 min/)).toBeInTheDocument();
    expect(course.getByText(/Study "Intro to SQL" on Kaggle/)).toBeInTheDocument();
    expect(course.getByText('Carried over from earlier days')).toBeInTheDocument();
    expect(course.getByText(/09:00–10:30, 11:30–12:30/)).toBeInTheDocument();
    expect(course.getByText('Finish the next two lessons')).toBeInTheDocument();

    const practice = await taskCard('Mock interview');
    expect(practice.getByText('Practice')).toBeInTheDocument();
    expect(practice.getByText('You answer all three without notes.')).toBeInTheDocument();
  });

  it('renders a link only where there is a url, opened safely, and flags lessons that need a check', async () => {
    open();
    const course = await taskCard('Intro to SQL');
    const taskLink = course.getByRole('link', { name: /Open on Kaggle/ });
    expect(taskLink).toHaveAttribute('href', 'https://example.test/sql');
    expect(taskLink).toHaveAttribute('rel', 'noopener noreferrer');
    expect(taskLink).toHaveAttribute('target', '_blank');

    const lessonLink = course.getByRole('link', { name: /Select basics/ });
    expect(lessonLink).toHaveAttribute('href', 'https://example.test/sql/1');
    expect(lessonLink).toHaveAttribute('rel', 'noopener noreferrer');
    // "Joins" has no url: text, never a link.
    expect(course.getByText('Joins')).toBeInTheDocument();
    expect(course.queryByRole('link', { name: /Joins/ })).toBeNull();
    // Not even an anchor without a destination.
    expect(course.getByText('Joins').closest('a')).toBeNull();
    expect(course.getAllByRole('link')).toHaveLength(2);

    // Only the lesson with needsCheck gets the badge.
    expect(course.getAllByText('Needs check')).toHaveLength(1);
    expect(course.getByText('Select basics').closest('p')).toHaveTextContent('Needs check');

    // The practice has no url and no lessons: no links at all.
    const practice = await taskCard('Mock interview');
    expect(practice.queryByRole('link')).toBeNull();
  });

  it('never renders a javascript: url as a link', async () => {
    const body = briefingBody();
    body.tasks[0]!.url = 'javascript:alert(1)';
    body.tasks[0]!.lessons[0]!.url = 'javascript:alert(2)';
    open({ [BRIEFING]: () => json(body) });
    const course = await taskCard('Intro to SQL');
    expect(course.queryByRole('link')).toBeNull();
  });

  it('shows the fixed-date warning on its own, with an icon and words', async () => {
    const body = briefingBody({
      overview:
        'Today is 4 hours of study. Warning: SQL exam on 2026-11-19 is at risk: 1 hour 30 minutes of the study before it does not fit. Review the options in the schedule.',
    });
    open({ [BRIEFING]: () => json(body) });
    const warning = await screen.findByRole('group', { name: 'Fixed date at risk' });
    expect(warning).toHaveTextContent('SQL exam on 2026-11-19 is at risk');
    expect(screen.getByText('Today is 4 hours of study.')).toBeInTheDocument();
  });

  it('shows no warning when the overview has none', async () => {
    open();
    await screen.findByText(/Today is 4 hours of study/);
    expect(screen.queryByRole('group', { name: 'Fixed date at risk' })).toBeNull();
  });

  it('copies the prompt and announces "Copied"', async () => {
    const user = userEvent.setup();
    open();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const practice = await taskCard('Mock interview');
    expect(practice.getByLabelText('Prompt for Mock interview')).toHaveTextContent(
      'Ask me three SQL questions.',
    );
    await user.click(practice.getByRole('button', { name: /Copy prompt/ }));
    expect(writeText).toHaveBeenCalledWith('Act as an interviewer.\nAsk me three SQL questions.');
    const status = practice.getAllByRole('status').find((el) => el.textContent === 'Copied');
    expect(status).toBeDefined();
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('falls back to selecting the text when the clipboard API is refused', async () => {
    const user = userEvent.setup();
    open();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) },
      configurable: true,
    });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    const practice = await taskCard('Mock interview');
    await user.click(practice.getByRole('button', { name: /Copy prompt/ }));
    await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'));
    expect(await practice.findByText('Copied')).toBeInTheDocument();
  });

  it('says so when nothing can copy, and keeps the text selected for a manual copy', async () => {
    const user = userEvent.setup();
    open();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const practice = await taskCard('Mock interview');
    await user.click(practice.getByRole('button', { name: /Copy prompt/ }));
    expect(await practice.findByRole('alert')).toHaveTextContent(/copy it by hand/i);
    expect(practice.queryByText('Copied')).toBeNull();
  });

  it('does not start the day until the button is pressed, then starts it and returns to Today', async () => {
    const user = userEvent.setup();
    const api = open();
    const button = await screen.findByRole('button', { name: 'Start study day' });
    expect(api.count(START)).toBe(0);
    await user.click(button);
    await waitFor(() => expect(api.count(START)).toBe(1));
    // Back on Today.
    expect(await screen.findByRole('heading', { name: 'Today', level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Day briefing' })).toBeNull();
  });

  it('keeps the person on the briefing and says so when the start fails', async () => {
    const user = userEvent.setup();
    open({ [START]: () => apiError(422, 'unprocessable', 'A future day cannot be started.') });
    await user.click(await screen.findByRole('button', { name: 'Start study day' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A future day cannot be started.');
    expect(screen.getByRole('heading', { name: 'Day briefing' })).toBeInTheDocument();
  });

  it('offers no start button once the day was started', async () => {
    const api = open({ [`GET ${BASE}/days/${DATE}`]: () => json(dayState({ status: 'started' })) });
    expect(await screen.findByText('Study day started')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start study day' })).toBeNull();
    expect(api.count(START)).toBe(0);
  });

  it('shows a frozen past day read-only: no start button, no way to change it', async () => {
    open({
      [`GET ${BASE}/days/${DATE}`]: () =>
        json(
          dayState({
            status: 'ended',
            frozen: { frozenAt: '2026-11-10T20:00:00Z', source: 'day_end', blocks: [] },
          }),
        ),
    });
    expect(await screen.findByText(/This day is over/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start study day' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Review this day' })).toHaveAttribute(
      'href',
      `/review/${DATE}`,
    );
  });

  it('shows a friendly state for a day the API will not serve (422)', async () => {
    open({
      [BRIEFING]: () => apiError(422, 'unprocessable', 'A future day has no briefing.'),
    });
    expect(
      await screen.findByRole('heading', { name: 'Not available for this day' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to Today' })).toHaveAttribute('href', '/');
  });

  it('shows the error with Retry, then the briefing after a retry', async () => {
    const user = userEvent.setup();
    let fail = true;
    open({
      [BRIEFING]: () => (fail ? apiError(500, 'internal', 'boom') : json(briefingBody())),
    });
    expect(await screen.findByText('Something went wrong on our side.')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
  });

  it('shows the offline state instead of loading forever', async () => {
    onlineManager.setOnline(false);
    open();
    expect(await screen.findByText(/You're offline/)).toBeInTheDocument();
  });

  it('shows the cold-start explanation when the server is slow', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      open({ [BRIEFING]: () => new Promise<Response>(() => {}) });
      expect(await screen.findByText('Loading the briefing…')).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(3500);
      expect(await screen.findByText(/Waking up the server/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a rest-day text when nothing is planned', async () => {
    open({
      [BRIEFING]: () =>
        json(briefingBody({ overview: 'A rest day.', tasks: [], suggestedOrder: [] })),
    });
    expect(await screen.findByText('Nothing is planned for this day.')).toBeInTheDocument();
  });

  it('redirects a malformed date to Today', async () => {
    installApi(dayRoutes());
    renderApp({ auth: fakeAuth(SESSION), path: '/briefing/not-a-date' });
    expect(await screen.findByRole('heading', { name: 'Today', level: 1 })).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    open();
    await screen.findByRole('heading', { name: 'Intro to SQL' });
    await expectNoAxeViolations();
  });
});
