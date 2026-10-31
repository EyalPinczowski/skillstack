import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { apiError, fakeAuth, installApi, json, renderApp, SESSION } from '../test/helpers';
import { PLAN_ID, planRoutes, TASKS, taskView } from '../test/plan-fixtures';

afterEach(() => vi.unstubAllGlobals());

const BASE = `/api/v1/plans/${PLAN_ID}`;

function open(path: string, extra: Parameters<typeof planRoutes>[0] = {}) {
  const api = installApi(planRoutes(extra));
  renderApp({ auth: fakeAuth(SESSION), path });
  return api;
}

describe('Plan page', () => {
  it('lists every task with status, type chip, hours, dependencies and fixed time', async () => {
    open('/plan');
    const list = await screen.findByRole('list');
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);

    const setup = within(rows[0]!);
    expect(setup.getByText('Admin')).toBeInTheDocument();
    expect(setup.getByText('Done')).toBeInTheDocument();
    expect(setup.getByText('0.5 h of 0.5 h')).toBeInTheDocument();

    const sql = within(rows[1]!);
    expect(sql.getByText('Course')).toBeInTheDocument();
    expect(sql.getByText('In progress')).toBeInTheDocument();
    expect(sql.getByText('After: Set up accounts')).toBeInTheDocument();

    const exam = within(rows[2]!);
    expect(exam.getByText('Exam')).toBeInTheDocument();
    expect(exam.getByText('Not started')).toBeInTheDocument();
    expect(exam.getByText('Fixed: Thu, Nov 19, 10:00')).toBeInTheDocument();
    expect(exam.getByText('After: Intro to SQL')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    open('/plan');
    await screen.findByRole('heading', { name: 'Demo plan' });
    await expectNoAxeViolations();
  });

  it('opens a task from the list', async () => {
    open('/plan');
    await userEvent.setup().click(await screen.findByRole('link', { name: 'Intro to SQL' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Intro to SQL' }),
    ).toBeInTheDocument();
  });

  it('shows a Retry when the tasks cannot be loaded', async () => {
    open('/plan', { [`GET ${BASE}/tasks`]: () => apiError(500, 'internal_error', 'boom') });
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side.');
  });
});

describe('Task detail', () => {
  it('shows steps, notes, lessons and an external link that opens safely', async () => {
    open('/plan/sql1');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Intro to SQL' }),
    ).toBeInTheDocument();
    const steps = within(screen.getByRole('heading', { name: 'How to do it' }).closest('section')!);
    expect(steps.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Create a free account',
      'Finish all lessons',
    ]);
    const notes = screen.getByRole('heading', { name: 'Notes' }).closest('section')!;
    expect(within(notes).getByText('Take notes as you go.')).toBeInTheDocument();
    expect(screen.getByText('Earns a certificate: SQL certificate.')).toBeInTheDocument();

    const course = screen.getByRole('link', { name: /Open the course page/ });
    expect(course).toHaveAttribute('href', 'https://example.test/sql');
    expect(course).toHaveAttribute('target', '_blank');
    expect(course).toHaveAttribute('rel', 'noopener noreferrer');

    const lesson = screen.getByRole('link', { name: /Select basics/ });
    expect(lesson).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText(/Needs check: confirm this link/)).toBeInTheDocument();
    // A lesson without a link is plain text.
    expect(screen.queryByRole('link', { name: /Joins/ })).not.toBeInTheDocument();
    expect(screen.getByText('Joins')).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('renders no link when the task has none, and never a javascript: link', async () => {
    open('/plan/exam', {
      [`GET ${BASE}/tasks`]: () =>
        json({
          tasks: [
            ...TASKS.slice(0, 2),
            taskView({
              id: 'exam',
              title: 'SQL exam',
              type: 'cert_exam',
              url: 'javascript:alert(1)',
              lessons: [{ title: 'Bad', url: 'javascript:alert(2)', needsCheck: false }],
            }),
          ],
        }),
    });
    await screen.findByRole('heading', { level: 1, name: 'SQL exam' });
    expect(screen.queryByRole('link', { name: /Open the course page/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Bad/ })).not.toBeInTheDocument();
    const anchors = Array.from(document.querySelectorAll('a[href^="javascript"]'));
    expect(anchors).toHaveLength(0);
  });

  it('saves only the changed fields with PATCH', async () => {
    let body: unknown;
    const api = open('/plan/sql1', {
      [`PATCH ${BASE}/tasks/sql1`]: async (request) => {
        body = await request.json();
        return json(taskView({ title: 'SQL basics', estHours: 4 }));
      },
    });
    const user = userEvent.setup();
    const title = await screen.findByRole('textbox', { name: 'Title' });
    await user.clear(title);
    await user.type(title, 'SQL basics');
    const hours = screen.getByRole('spinbutton', { name: 'Estimated hours' });
    await user.clear(hours);
    await user.type(hours, '4');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(body).toEqual({ title: 'SQL basics', estHours: 4 });
    expect(api.count(`PATCH ${BASE}/tasks/sql1`)).toBe(1);
  });

  it('clears the notes with null', async () => {
    let body: unknown;
    open('/plan/sql1', {
      [`PATCH ${BASE}/tasks/sql1`]: async (request) => {
        body = await request.json();
        return json(taskView({ notes: undefined }));
      },
    });
    const user = userEvent.setup();
    await user.clear(await screen.findByRole('textbox', { name: 'Notes' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(body).toEqual({ notes: null });
  });

  it('sends nothing when nothing changed', async () => {
    const api = open('/plan/sql1');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing has changed yet.');
    expect(api.count(`PATCH ${BASE}/tasks/sql1`)).toBe(0);
  });

  it('shows the API’s message when the edit is refused', async () => {
    open('/plan/sql1', {
      [`PATCH ${BASE}/tasks/sql1`]: () =>
        apiError(422, 'unprocessable', 'Dependencies must not form a loop.'),
    });
    const user = userEvent.setup();
    const title = await screen.findByRole('textbox', { name: 'Title' });
    await user.type(title, ' 2');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Dependencies must not form a loop.',
    );
  });

  it('says so when the task is not in the plan', async () => {
    open('/plan/missing');
    expect(await screen.findByRole('alert')).toHaveTextContent('This task is not in the plan.');
  });

  it('offers Reopen only for a done or skipped task, and only acts on click', async () => {
    const api = open('/plan/setup', {
      [`POST ${BASE}/tasks/setup/reopen`]: () => json(taskView({ id: 'setup' })),
    });
    const button = await screen.findByRole('button', { name: /Reopen/ });
    expect(api.count(`POST ${BASE}/tasks/setup/reopen`)).toBe(0);
    await userEvent.setup().click(button);
    await vi.waitFor(() => expect(api.count(`POST ${BASE}/tasks/setup/reopen`)).toBe(1));
  });
});
