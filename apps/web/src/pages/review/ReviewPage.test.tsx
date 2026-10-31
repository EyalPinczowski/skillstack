import { onlineManager } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BASE, bodyOf, briefingBody, DATE, dayRoutes, storedReview } from '../../test/day-fixtures';
import { expectNoAxeViolations } from '../../test/axe';
import { apiError, fakeAuth, installApi, json, renderApp, SESSION } from '../../test/helpers';
import { NOW } from '../../test/plan-fixtures';

afterEach(() => {
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
});

const PUT = `PUT ${BASE}/days/${DATE}/review`;
const LOGS = `POST ${BASE}/tasks/sql1/logs`;
const COMPLETE = `POST ${BASE}/tasks/practice1/complete`;

const savedResponse = (overrides: Record<string, unknown> = {}, created = true) =>
  json(
    {
      review: storedReview(),
      created,
      missingLogs: [],
      notMarkedDone: [],
      suggestions: [],
      ...overrides,
    },
    created ? 201 : 200,
  );

function open(extra: Parameters<typeof dayRoutes>[0] = {}) {
  const api = installApi(dayRoutes(extra));
  renderApp({ auth: fakeAuth(SESSION), path: `/review/${DATE}` });
  return api;
}

const group = (name: string) => within(screen.getByRole('group', { name }));
const DIFFICULTY = 'How hard was today’s content?';
const DENSITY = 'How full was the day?';
const ENERGY = 'How was your energy and focus?';

async function formReady() {
  return screen.findByRole('form', { name: 'End-of-day review' });
}

/** Fills the three scales: difficulty 4, density 5, energy 2. */
async function rate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(group(DIFFICULTY).getByRole('radio', { name: '4 of 5, Hard' }));
  await user.click(group(DENSITY).getByRole('radio', { name: '5 of 5, Too much' }));
  await user.click(group(ENERGY).getByRole('radio', { name: '2 of 5, Low' }));
}

const save = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: /Save review|Update review/ }));

describe('End-of-day review form', () => {
  it('lists the day’s tasks and the three scales, and saves nothing on its own', async () => {
    const api = open();
    await formReady();
    expect(screen.getByRole('radio', { name: 'Done: Intro to SQL' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Partly done: Mock interview' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Not done: Mock interview' })).toBeInTheDocument();
    // Three labelled scales of five options each, with word labels for density.
    for (const legend of [DIFFICULTY, DENSITY, ENERGY]) {
      expect(group(legend).getAllByRole('radio')).toHaveLength(5);
    }
    expect(group(DENSITY).getByRole('radio', { name: '1 of 5, Too light' })).toBeInTheDocument();
    expect(group(DENSITY).getByRole('radio', { name: '3 of 5, Just right' })).toBeInTheDocument();
    expect(group(DENSITY).getByRole('radio', { name: '5 of 5, Too much' })).toBeInTheDocument();
    expect(api.count(PUT)).toBe(0);
    expect(api.count(LOGS)).toBe(0);
    expect(api.count(COMPLETE)).toBe(0);
  });

  it('requires all three scales before anything is sent', async () => {
    const user = userEvent.setup();
    const api = open();
    await formReady();
    await save(user);
    expect(
      await screen.findByText('Choose 1 to 5 for how hard the content was.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Choose 1 to 5 for how full the day was.')).toBeInTheDocument();
    expect(screen.getByText('Choose 1 to 5 for your energy.')).toBeInTheDocument();
    expect(api.count(PUT)).toBe(0);

    // One scale answered: the other two are still required.
    await user.click(group(ENERGY).getByRole('radio', { name: '3 of 5, OK' }));
    await save(user);
    expect(screen.queryByText('Choose 1 to 5 for your energy.')).toBeNull();
    expect(screen.getByText('Choose 1 to 5 for how full the day was.')).toBeInTheDocument();
    expect(api.count(PUT)).toBe(0);
  });

  it('requires hours above 0 for a partly done task', async () => {
    const user = userEvent.setup();
    const api = open();
    await formReady();
    await rate(user);
    await user.click(screen.getByRole('radio', { name: 'Partly done: Intro to SQL' }));
    const hours = screen.getByLabelText('Hours spent on Intro to SQL');

    await save(user);
    expect(await screen.findByText(/Enter the hours as a number above 0/)).toBeInTheDocument();
    expect(hours).toHaveAttribute('aria-invalid', 'true');

    await user.type(hours, '0');
    await save(user);
    expect(screen.getByText(/Enter the hours as a number above 0/)).toBeInTheDocument();

    await user.clear(hours);
    await user.type(hours, '-1');
    await save(user);
    expect(screen.getByText(/Enter the hours as a number above 0/)).toBeInTheDocument();

    await user.clear(hours);
    await user.type(hours, '25');
    await save(user);
    expect(screen.getByText(/Enter the hours as a number above 0/)).toBeInTheDocument();
    expect(api.count(PUT)).toBe(0);
  });

  it('sends exactly the answers given: hours only for partial, reasons only when written', async () => {
    const user = userEvent.setup();
    const api = open({ [PUT]: () => savedResponse() });
    await formReady();
    await rate(user);

    await user.click(screen.getByRole('radio', { name: 'Partly done: Intro to SQL' }));
    await user.type(screen.getByLabelText('Hours spent on Intro to SQL'), '1.5');
    await user.type(
      screen.getByLabelText('Reason (optional) for Intro to SQL'),
      '  Ran out of time ',
    );
    await user.click(screen.getByRole('radio', { name: 'Not done: Mock interview' }));
    await user.type(screen.getByLabelText('Note (optional)'), 'Tiring day');
    await save(user);

    await waitFor(() => expect(api.count(PUT)).toBe(1));
    const request = api.calls.find((c) => `${c.method} ${new URL(c.url).pathname}` === PUT)!;
    expect(await bodyOf(request)).toEqual({
      date: DATE,
      difficulty: 4,
      density: 5,
      energy: 2,
      note: 'Tiring day',
      outcomes: [
        { taskId: 'sql1', outcome: 'partial', hours: 1.5, reason: 'Ran out of time' },
        { taskId: 'practice1', outcome: 'not_done' },
      ],
    });
  });

  it('drops hours that were typed before the answer changed away from partly done', async () => {
    const user = userEvent.setup();
    const api = open({ [PUT]: () => savedResponse() });
    await formReady();
    await rate(user);
    await user.click(screen.getByRole('radio', { name: 'Partly done: Intro to SQL' }));
    await user.type(screen.getByLabelText('Hours spent on Intro to SQL'), '2');
    await user.click(screen.getByRole('radio', { name: 'Not done: Intro to SQL' }));
    await user.click(screen.getByRole('radio', { name: 'Done: Mock interview' }));
    await save(user);
    await waitFor(() => expect(api.count(PUT)).toBe(1));
    const request = api.calls.find((c) => `${c.method} ${new URL(c.url).pathname}` === PUT)!;
    expect(((await bodyOf(request)) as { outcomes: unknown[] }).outcomes).toEqual([
      { taskId: 'sql1', outcome: 'not_done' },
      { taskId: 'practice1', outcome: 'done' },
    ]);
  });

  it('leaves unanswered tasks out of the request', async () => {
    const user = userEvent.setup();
    const api = open({ [PUT]: () => savedResponse() });
    await formReady();
    await rate(user);
    await save(user);
    await waitFor(() => expect(api.count(PUT)).toBe(1));
    const request = api.calls.find((c) => `${c.method} ${new URL(c.url).pathname}` === PUT)!;
    expect(await bodyOf(request)).toEqual({
      date: DATE,
      difficulty: 4,
      density: 5,
      energy: 2,
      note: '',
      outcomes: [],
    });
  });

  it('counts the note and stops at 2000 characters', async () => {
    const user = userEvent.setup();
    open();
    await formReady();
    const note = screen.getByLabelText('Note (optional)');
    expect(note).toHaveAttribute('maxlength', '2000');
    expect(screen.getByText('0 / 2000 characters')).toBeInTheDocument();
    await user.type(note, 'hello');
    expect(screen.getByText('5 / 2000 characters')).toBeInTheDocument();
  });

  it('never logs hours or marks a task done by itself: it offers explicit buttons that send exact requests', async () => {
    const user = userEvent.setup();
    const api = open({
      [PUT]: () =>
        savedResponse({
          missingLogs: [{ taskId: 'sql1', reportedHours: 1.5, loggedHours: 0.5, missingHours: 1 }],
          notMarkedDone: ['practice1'],
        }),
      [LOGS]: async (request) => {
        const body = (await request.clone().json()) as { id: string; date: string; hours: number };
        return json(
          {
            log: {
              id: body.id,
              planId: 'p',
              taskId: 'sql1',
              date: body.date,
              hours: body.hours,
              createdAt: NOW,
            },
            task: {},
            suggestDone: false,
          },
          201,
        );
      },
      [COMPLETE]: () => json({ id: 'practice1' }),
    });
    await formReady();
    await rate(user);
    await user.click(screen.getByRole('radio', { name: 'Partly done: Intro to SQL' }));
    await user.type(screen.getByLabelText('Hours spent on Intro to SQL'), '1.5');
    await user.click(screen.getByRole('radio', { name: 'Done: Mock interview' }));
    await save(user);

    expect(await screen.findByRole('heading', { name: 'Review saved' })).toBeInTheDocument();
    expect(
      screen.getByText(/reported 1.5 h, logged 0.5 h, not logged yet 1 h/),
    ).toBeInTheDocument();
    // The review was saved, but nothing else happened.
    expect(api.count(LOGS)).toBe(0);
    expect(api.count(COMPLETE)).toBe(0);

    await user.click(screen.getByRole('button', { name: /Log these hours/ }));
    await waitFor(() => expect(api.count(LOGS)).toBe(1));
    const logRequest = api.calls.find((c) => `${c.method} ${new URL(c.url).pathname}` === LOGS)!;
    expect(await bodyOf(logRequest)).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      date: DATE,
      hours: 1,
    });
    expect(await screen.findByText('Logged 1 h on Intro to SQL')).toBeInTheDocument();
    expect(api.count(COMPLETE)).toBe(0);

    await user.click(screen.getByRole('button', { name: /Mark done/ }));
    await waitFor(() => expect(api.count(COMPLETE)).toBe(1));
    expect(await screen.findByText('Marked Mock interview as done')).toBeInTheDocument();
    expect(api.count(LOGS)).toBe(1);
  });

  it('shows a failed log in words and lets the person retry', async () => {
    const user = userEvent.setup();
    open({
      [PUT]: () =>
        savedResponse({
          missingLogs: [{ taskId: 'sql1', reportedHours: 2, loggedHours: 0, missingHours: 2 }],
        }),
      [LOGS]: () => apiError(422, 'unprocessable', 'Hours cannot be logged on a skipped task.'),
    });
    await formReady();
    await rate(user);
    await save(user);
    await user.click(await screen.findByRole('button', { name: /Log these hours/ }));
    expect(
      await screen.findByText('Hours cannot be logged on a skipped task.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Log these hours/ })).toBeEnabled();
  });

  it('says when the review is changed and nothing is left to do', async () => {
    const user = userEvent.setup();
    open({ [PUT]: () => savedResponse({}, false) });
    await formReady();
    await rate(user);
    await save(user);
    expect(await screen.findByRole('heading', { name: 'Review updated' })).toBeInTheDocument();
    expect(screen.getByText('Nothing else needs your attention for this day.')).toBeInTheDocument();
  });

  it('explains a closed editing window (409) and keeps the answers', async () => {
    const user = userEvent.setup();
    open({
      [PUT]: () =>
        apiError(409, 'conflict', 'A review can be changed only on its day and the day after.'),
    });
    await formReady();
    await rate(user);
    await user.type(screen.getByLabelText('Note (optional)'), 'Keep me');
    await save(user);
    expect(
      await screen.findByText('A review can be changed only on its day and the day after.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Note (optional)')).toHaveValue('Keep me');
    expect(group(DIFFICULTY).getByRole('radio', { name: '4 of 5, Hard' })).toBeChecked();
  });

  it('explains a refused review (422), such as a day that was not a study day', async () => {
    const user = userEvent.setup();
    open({ [PUT]: () => apiError(422, 'unprocessable', 'Only a study day can be reviewed.') });
    await formReady();
    await rate(user);
    await save(user);
    expect(await screen.findByText('Only a study day can be reviewed.')).toBeInTheDocument();
  });

  it('says nothing was saved when the server cannot be reached', async () => {
    const user = userEvent.setup();
    open({
      [PUT]: () => {
        throw new TypeError('network down');
      },
    });
    await formReady();
    await rate(user);
    await save(user);
    expect(await screen.findByText(/Nothing was saved/)).toBeInTheDocument();
  });

  it('pre-fills from the stored review, including extra tasks it recorded', async () => {
    const body = briefingBody();
    body.tasks = body.tasks.slice(0, 1);
    const api = open({
      [`GET ${BASE}/days/${DATE}/briefing`]: () => json(body),
      [`GET ${BASE}/days/${DATE}/review`]: () =>
        json(
          storedReview({
            outcomes: [
              { taskId: 'sql1', outcome: 'partial', hours: 1.5, reason: 'Ran out of time' },
              { taskId: 'setup', outcome: 'done' },
            ],
          }),
        ),
      [PUT]: () => savedResponse({}, false),
    });
    const user = userEvent.setup();
    await formReady();
    expect(group(DIFFICULTY).getByRole('radio', { name: '4 of 5, Hard' })).toBeChecked();
    expect(group(DENSITY).getByRole('radio', { name: '5 of 5, Too much' })).toBeChecked();
    expect(group(ENERGY).getByRole('radio', { name: '2 of 5, Low' })).toBeChecked();
    expect(screen.getByLabelText('Note (optional)')).toHaveValue('Tiring day');
    expect(screen.getByRole('radio', { name: 'Partly done: Intro to SQL' })).toBeChecked();
    expect(screen.getByLabelText('Hours spent on Intro to SQL')).toHaveValue(1.5);
    // "Set up accounts" is not in today's briefing but the review answered it: it stays editable.
    expect(screen.getByRole('radio', { name: 'Done: Set up accounts' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Update review' }));
    await waitFor(() => expect(api.count(PUT)).toBe(1));
    const request = api.calls.find((c) => `${c.method} ${new URL(c.url).pathname}` === PUT)!;
    expect(await bodyOf(request)).toEqual({
      date: DATE,
      difficulty: 4,
      density: 5,
      energy: 2,
      note: 'Tiring day',
      outcomes: [
        { taskId: 'sql1', outcome: 'partial', hours: 1.5, reason: 'Ran out of time' },
        { taskId: 'setup', outcome: 'done' },
      ],
    });
  });

  it('shows the friendly state for a day that cannot be reviewed yet (422)', async () => {
    open({
      [`GET ${BASE}/days/${DATE}/briefing`]: () =>
        apiError(422, 'unprocessable', 'A future day has no briefing.'),
    });
    expect(
      await screen.findByRole('heading', { name: 'Not available for this day' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('shows the offline state', async () => {
    onlineManager.setOnline(false);
    open();
    expect(await screen.findAllByText(/You're offline/)).not.toHaveLength(0);
  });

  it('has no accessibility violations, before and after saving', async () => {
    const user = userEvent.setup();
    open({
      [PUT]: () =>
        savedResponse({
          missingLogs: [{ taskId: 'sql1', reportedHours: 1.5, loggedHours: 0.5, missingHours: 1 }],
          notMarkedDone: ['practice1'],
        }),
      [`GET ${BASE}/reviews`]: () =>
        json({ reviews: [{ date: DATE, difficulty: 4, density: 5, energy: 2 }] }),
    });
    await formReady();
    await user.click(screen.getByRole('radio', { name: 'Partly done: Intro to SQL' }));
    await expectNoAxeViolations();
    await user.type(screen.getByLabelText('Hours spent on Intro to SQL'), '1.5');
    await rate(user);
    await save(user);
    await screen.findByRole('heading', { name: 'Review saved' });
    await screen.findByRole('img', { name: /Difficulty, density and energy/ });
    await expectNoAxeViolations();
  });
});

describe('Review history trend', () => {
  const REVIEWS = `GET ${BASE}/reviews`;

  it('draws a chart with labelled axes and a table with the same numbers', async () => {
    const user = userEvent.setup();
    const api = open({
      [REVIEWS]: () =>
        json({
          reviews: [
            { date: '2026-11-08', difficulty: 2, density: 3, energy: 4 },
            { date: DATE, difficulty: 4, density: 5, energy: 2 },
          ],
        }),
    });
    const chart = await screen.findByRole('img', {
      name: /Difficulty, density and energy ratings/,
    });
    expect(
      within(chart as unknown as HTMLElement).getByText('Rating (1 to 5)'),
    ).toBeInTheDocument();
    expect(within(chart as unknown as HTMLElement).getByText('Date')).toBeInTheDocument();
    // Asked for the 30 days that end on the reviewed day.
    const request = api.calls.find((c) => new URL(c.url).pathname === `${BASE}/reviews`)!;
    const url = new URL(request.url);
    expect(url.searchParams.get('from')).toBe('2026-10-12');
    expect(url.searchParams.get('to')).toBe(DATE);

    await user.click(screen.getByText('Show the data as a table'));
    const table = screen.getByRole('table', { name: 'Daily ratings from 1 to 5' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[2]).toHaveTextContent('Tue, Nov 10452');
    // Series are told apart by words as well as colour.
    expect(screen.getByRole('list', { name: 'Legend' })).toHaveTextContent(
      'DifficultyDensityEnergy',
    );
  });

  it('says so when there are no reviews yet', async () => {
    open();
    expect(await screen.findByText(/No reviews in this period yet/)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Difficulty, density/ })).toBeNull();
  });
});
