import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { apiError, fakeAuth, installApi, json, renderApp, SESSION } from '../test/helpers';
import { PLAN_ID, planDetail, planRoutes, planSummary } from '../test/plan-fixtures';

afterEach(() => vi.unstubAllGlobals());

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MINIMAL_PLAN = JSON.stringify({
  formatVersion: 1,
  name: 'My plan',
  startDate: '2026-11-03',
  tasks: [],
});

/** The signed-in app with no plan until an import succeeds. */
function openEmpty(importHandler: (request: Request) => Response | Promise<Response>) {
  let imported = false;
  const bodies: Record<string, unknown>[] = [];
  const routes = planRoutes({
    'GET /api/v1/plans': () => json({ plans: imported ? [planSummary()] : [] }),
    'POST /api/v1/plans/import': async (request) => {
      bodies.push((await request.clone().json()) as Record<string, unknown>);
      const response = await importHandler(request);
      if (response.ok) imported = true;
      return response;
    },
  });
  const api = installApi(routes);
  renderApp({ auth: fakeAuth(SESSION), path: '/' });
  return { api, bodies };
}

const pasteBox = () => screen.getByRole('textbox', { name: /paste the plan json/i });

describe('plan import (empty state)', () => {
  it('shows the empty state with both ways to bring a plan in', async () => {
    openEmpty(() => json(planDetail(), 201));
    expect(await screen.findByRole('heading', { name: 'No plan yet' })).toBeInTheDocument();
    expect(screen.getByLabelText('Plan file')).toBeInTheDocument();
    expect(pasteBox()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load the demo plan' })).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('pasting something that is not JSON shows a message and sends nothing', async () => {
    const { api } = openEmpty(() => json(planDetail(), 201));
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'No plan yet' });
    await user.click(pasteBox());
    await user.paste('this is { not json');
    await user.click(screen.getByRole('button', { name: 'Import plan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That is not valid JSON');
    expect(api.count('POST /api/v1/plans/import')).toBe(0);
  });

  it('pasting an empty box asks for a plan first', async () => {
    const { api } = openEmpty(() => json(planDetail(), 201));
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'No plan yet' });
    await user.click(screen.getByRole('button', { name: 'Import plan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Paste a plan or choose a plan file',
    );
    expect(api.count('POST /api/v1/plans/import')).toBe(0);
  });

  it('imports a pasted plan with a client-generated UUID and then shows the day', async () => {
    const { bodies } = openEmpty(() => json(planDetail(), 201));
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'No plan yet' });
    await user.click(pasteBox());
    await user.paste(MINIMAL_PLAN);
    await user.click(screen.getByRole('button', { name: 'Import plan' }));
    expect(await screen.findByText('Day 8 of 18', { exact: false })).toBeInTheDocument();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.id).toMatch(UUID);
    expect(bodies[0]).toMatchObject({ formatVersion: 1, name: 'My plan' });
    // The plan id is the API's idempotency key; nothing about the person goes along.
    expect(Object.keys(bodies[0]!)).not.toContain('user_id');
  });

  it('reads a chosen file into the box and imports it after the person confirms', async () => {
    const { bodies } = openEmpty(() => json(planDetail(), 201));
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'No plan yet' });
    await user.upload(
      screen.getByLabelText('Plan file'),
      new File([MINIMAL_PLAN], 'plan.json', { type: 'application/json' }),
    );
    expect(await screen.findByText(/Loaded plan\.json/)).toBeInTheDocument();
    expect(pasteBox()).toHaveValue(MINIMAL_PLAN);
    expect(bodies).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Import plan' }));
    expect(await screen.findByText('Day 8 of 18', { exact: false })).toBeInTheDocument();
    expect(bodies[0]).toMatchObject({ name: 'My plan' });
  });

  it('loads the bundled demo plan with one click', async () => {
    const { bodies } = openEmpty(() => json(planDetail(), 201));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Load the demo plan' }));
    expect(await screen.findByText('Day 8 of 18', { exact: false })).toBeInTheDocument();
    expect(bodies[0]).toMatchObject({
      formatVersion: 1,
      name: 'Junior Data Analyst (fictional demo plan)',
    });
    expect(bodies[0]!.id).toMatch(UUID);
    expect((bodies[0]!.tasks as unknown[]).length).toBeGreaterThan(5);
  });

  it('shows the API 422 messages as a readable list and keeps what was pasted', async () => {
    openEmpty(() =>
      apiError(
        422,
        'unprocessable',
        'Invalid plan file. tasks.0.estHours: Too small; weekPattern.timezone: Unknown time zone',
      ),
    );
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'No plan yet' });
    await user.click(pasteBox());
    await user.paste(MINIMAL_PLAN);
    await user.click(screen.getByRole('button', { name: 'Import plan' }));
    const alert = await screen.findByText('The plan file is not valid.');
    const box = alert.closest('[role="alert"]') as HTMLElement;
    const items = within(box).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'tasks.0.estHours: Too small',
      'weekPattern.timezone: Unknown time zone',
    ]);
    expect(pasteBox()).toHaveValue(MINIMAL_PLAN);
  });

  it('retries after a lost connection with the same plan id, so nothing is added twice', async () => {
    let calls = 0;
    const { bodies } = openEmpty(() => {
      calls += 1;
      if (calls === 1) throw new TypeError('network down');
      // The first attempt may have reached the server: an idempotent retry answers 200.
      return json(planDetail(), 200);
    });
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'No plan yet' });
    await user.click(pasteBox());
    await user.paste(MINIMAL_PLAN);
    await user.click(screen.getByRole('button', { name: 'Import plan' }));
    expect(await screen.findByText(/Can’t reach the server/)).toBeInTheDocument();
    expect(screen.getByText(/Trying again is safe/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import plan' }));
    expect(await screen.findByText('Day 8 of 18', { exact: false })).toBeInTheDocument();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.id).toBe(bodies[0]!.id);
  });

  it('on a 409 conflict explains it and uses a fresh id for the next try', async () => {
    let calls = 0;
    const { bodies } = openEmpty(() => {
      calls += 1;
      return calls === 1
        ? apiError(409, 'conflict', 'A plan with this id already exists with different content.')
        : json(planDetail(), 201);
    });
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'No plan yet' });
    await user.click(pasteBox());
    await user.paste(MINIMAL_PLAN);
    await user.click(screen.getByRole('button', { name: 'Import plan' }));
    expect(await screen.findByText(/already exists with different content/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing was changed/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import plan' }));
    expect(await screen.findByText('Day 8 of 18', { exact: false })).toBeInTheDocument();
    expect(bodies[1]!.id).not.toBe(bodies[0]!.id);
  });

  it('treats an idempotent 200 replay like a success', async () => {
    openEmpty(() => json(planDetail({ id: PLAN_ID }), 200));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Load the demo plan' }));
    expect(await screen.findByText('Day 8 of 18', { exact: false })).toBeInTheDocument();
  });
});
