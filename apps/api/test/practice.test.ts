import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createDatabase, type Database } from '../src/db/database';
import { createSupabaseVerifier } from '../src/modules/accounts/token-verifier';
import { sessionLogId } from '../src/modules/practice/service';
import { acceptCurrentLegal, dbAvailable, prepareDatabase, type TestDb } from './db-helpers';
import { testConfig } from './helpers';
import { ISSUER, makeTestKeys, type TestKeys } from './tokens';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const PLAN_A = 'a0000000-0000-4000-8000-000000000001';
const PLAN_A2 = 'a0000000-0000-4000-8000-000000000002';
const PLAN_B = 'b0000000-0000-4000-8000-000000000001';
const S = (n: number) => `d0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

const NOW = new Date('2026-11-02T10:00:00Z');

const BLOCK = (score: string, focus = 'Quantify the result of every story') =>
  `Here you go.\n===FEEDBACK===\nscore: ${score}\nstrengths: Clear structure and calm delivery\nimprove: Give numbers\nnext_focus: ${focus}\n===END===`;

type Method = 'GET' | 'POST' | 'PUT';

describe.skipIf(!dbAvailable)('practice sessions without a model (real Postgres)', () => {
  let testDb: TestDb;
  let db: Database;
  let keys: TestKeys;
  let app: ReturnType<typeof buildApp>;
  let clock = NOW;

  beforeAll(async () => {
    testDb = await prepareDatabase();
    keys = await makeTestKeys();
    db = createDatabase({ connectionString: testDb.appUrl('rnd'), appEnv: 'rnd' });
    app = buildApp(testConfig({ appEnv: 'rnd', rateLimitPerMinute: 100_000 }), {
      verifier: createSupabaseVerifier({ issuer: ISSUER, keys: keys.keys }),
      db,
      now: () => clock,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  const rows = <R = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    testDb.admin(async (c) => (await c.query(sql, params)).rows as R[]);

  beforeEach(async () => {
    clock = NOW;
    await testDb.admin(async (c) => {
      await c.query('delete from rnd.app_users');
      await c.query('delete from rnd.allowed_emails');
      await c.query(
        `insert into rnd.allowed_emails (email)
         values ('zed.quill@example.com'), ('b@example.com'), ('c@example.com')`,
      );
      await c.query(
        `insert into rnd.app_users (id, email, display_name)
         values ($1, 'zed.quill@example.com', 'Zebediah Quillfeather'),
                ($2, 'b@example.com', null), ($3, 'c@example.com', null)`,
        [A, B, C],
      );
      // C never accepts the terms.
      await acceptCurrentLegal(c, [A, B]);
      const plan = async (user: string, id: string) => {
        await c.query(
          `insert into rnd.plans (user_id, id, created_from, name, status, start_date, created_at)
           values ($1, $2, 'builder', 'Plan', 'active', '2026-11-01', '2026-10-30T10:00:00Z')`,
          [user, id],
        );
        await c.query(
          `insert into rnd.week_patterns (user_id, plan_id, study_weekdays, default_hours,
             window_start, window_end, timezone)
           values ($1, $2, '{0,1,2,3,4}', 2, '09:00', '17:00', 'Asia/Jerusalem')`,
          [user, id],
        );
      };
      const task = (
        user: string,
        planId: string,
        id: string,
        order: number,
        o: { type?: string; kind?: string | null; steps?: string[]; est?: number } = {},
      ) =>
        c.query(
          `insert into rnd.tasks (user_id, plan_id, id, title, type, est_hours, sort_order,
             practice_kind, how_to_steps, prompt_template)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
          [
            user,
            planId,
            id,
            `Task ${id}`,
            o.type ?? 'practice',
            o.est ?? 1,
            order,
            o.kind === undefined ? 'mock_interview' : o.kind,
            JSON.stringify(o.steps ?? ['Prepare', 'Answer aloud', 'Review answers', 'Note gaps']),
            'Run a mock interview with me.',
          ],
        );
      await plan(A, PLAN_A);
      await plan(A, PLAN_A2);
      await plan(B, PLAN_B);
      await task(A, PLAN_A, 'p1', 0);
      await task(A, PLAN_A, 'p2', 1);
      await task(A, PLAN_A, 'p3', 2, { kind: 'home_assignment' });
      await task(A, PLAN_A, 'p4', 3, { kind: null, steps: [] });
      await task(A, PLAN_A, 'c1', 4, { type: 'course', kind: null });
      await task(A, PLAN_A2, 'other', 0);
      await task(B, PLAN_B, 'p1', 0);
    });
  });

  const as = async (sub: string, email: string) => ({
    authorization: `Bearer ${await keys.sign({ sub, email })}`,
  });
  const asA = () => as(A, 'zed.quill@example.com');
  const asB = () => as(B, 'b@example.com');
  const call = async (
    method: Method,
    url: string,
    headers: Record<string, string>,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers,
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const callA = async (method: Method, url: string, payload?: unknown) =>
    call(method, url, await asA(), payload);

  const base = `/plans/${PLAN_A}`;
  const sessionsUrl = (task: string) => `${base}/tasks/${task}/practice/sessions`;
  const sessionUrl = (id: string, tail = '') => `${base}/practice/sessions/${id}${tail}`;
  const start = async (task: string, id: string, channel = 'external') => {
    const res = await callA('POST', sessionsUrl(task), { id, channel });
    expect(res.statusCode).toBe(201);
    return res.json();
  };
  const taskRow = async (id: string, plan = PLAN_A) =>
    (
      await rows<{ status: string; done_hours: number }>(
        `select status, done_hours::float8 from rnd.tasks where plan_id = $1 and id = $2`,
        [plan, id],
      )
    )[0]!;

  // -------------------------------------------------------------------------------------------

  describe('access', () => {
    it('answers 404 for another user’s plan, task and session on every route', async () => {
      await start('p1', S(1));
      const b = await asB();
      const probes: [Method, string, unknown?][] = [
        ['GET', `${base}/practice/context`],
        ['PUT', `${base}/practice/context`, { jobDescription: 'x' }],
        ['GET', `${base}/tasks/p1/practice/prompt`],
        ['POST', sessionsUrl('p1'), { id: S(2), channel: 'self' }],
        ['GET', sessionUrl(S(1))],
        ['POST', sessionUrl(S(1), '/feedback'), { text: BLOCK('7/10') }],
        ['POST', sessionUrl(S(1), '/finish'), { markDone: true }],
        ['POST', sessionUrl(S(1), '/abandon')],
        ['GET', `${base}/practice/history`],
        ['GET', `${base}/practice/trends`],
      ];
      for (const [method, url, payload] of probes) {
        const res = await call(method, url, b, payload);
        expect(res.statusCode, `${method} ${url}`).toBe(404);
      }
      // Nothing changed for A.
      expect((await rows(`select status from rnd.practice_sessions`))[0]).toMatchObject({
        status: 'active',
      });
      expect(await rows(`select 1 from rnd.events where type = 'practice.finished'`)).toHaveLength(
        0,
      );
    });

    it('does not show a session through another plan of the same user, or a task of another plan', async () => {
      await start('p1', S(1));
      expect((await callA('GET', `/plans/${PLAN_A2}/practice/sessions/${S(1)}`)).statusCode).toBe(
        404,
      );
      expect(
        (
          await callA('POST', `/plans/${PLAN_A2}/tasks/p1/practice/sessions`, {
            id: S(5),
            channel: 'self',
          })
        ).statusCode,
      ).toBe(404);
    });

    it('never takes a user id from the client', async () => {
      const res = await callA('POST', sessionsUrl('p1'), { id: S(1), channel: 'self', userId: B });
      expect(res.statusCode).toBe(400);
      const put = await callA('PUT', `${base}/practice/context`, {
        jobDescription: 'x',
        user_id: B,
      });
      expect(put.statusCode).toBe(400);
      const fin = await callA('POST', sessionUrl(S(1), '/finish'), { markDone: false, user_id: B });
      expect(fin.statusCode).toBe(400);
    });

    it('refuses every practice route until the terms are accepted', async () => {
      const doc = app.swagger() as { paths: Record<string, Record<string, unknown>> };
      const practice = Object.entries(doc.paths).flatMap(([path, item]) =>
        Object.keys(item)
          .filter((m) => ['get', 'post', 'put'].includes(m))
          .map((method) => ({ path, method })),
      );
      const ours = practice.filter((p) => p.path.includes('/practice/'));
      expect(ours.length).toBeGreaterThanOrEqual(9);
      const headers = await as(C, 'c@example.com');
      for (const { path, method } of ours) {
        const url = path
          .replace('{planId}', PLAN_A)
          .replace('{taskId}', 'p1')
          .replace('{sessionId}', S(1));
        const res = await app.inject({
          method: method.toUpperCase() as Method,
          url,
          headers,
          payload: method === 'get' ? undefined : {},
        });
        expect(res.statusCode, `${method} ${path}`).toBe(403);
        expect(res.json().error.code).toBe('terms_not_accepted');
      }
    });

    it('rejects NUL characters with 422', async () => {
      await start('p1', S(1));
      const put = await callA('PUT', `${base}/practice/context`, { jobDescription: 'a\u0000b' });
      expect(put.statusCode).toBe(422);
      const paste = await callA('POST', sessionUrl(S(1), '/feedback'), { text: 'a\u0000b' });
      expect(paste.statusCode).toBe(422);
      const taskNul = await callA('GET', `${base}/tasks/p\u00001/practice/prompt`);
      expect([404, 422]).toContain(taskNul.statusCode);
      expect((await rows(`select status from rnd.practice_sessions`))[0]).toMatchObject({
        status: 'active',
      });
    });
  });

  describe('context and prompt', () => {
    it('saves, reads and clears the job description, and previews what is removed', async () => {
      const empty = await callA('GET', `${base}/practice/context`);
      expect(empty.json()).toEqual({ jobDescription: '', updatedAt: null });

      const put = await callA('PUT', `${base}/practice/context`, {
        jobDescription: 'Ops analyst. Write to hr@acme.example or see https://acme.example/jobs.',
      });
      expect(put.statusCode).toBe(200);
      expect(put.json().redactionsPreview).toBeGreaterThanOrEqual(2);
      expect((await callA('GET', `${base}/practice/context`)).json().jobDescription).toContain(
        'hr@acme.example',
      );
      const cleared = await callA('PUT', `${base}/practice/context`, { jobDescription: '' });
      expect(cleared.json()).toMatchObject({ jobDescription: '', redactionsPreview: 0 });
      expect(
        (await callA('PUT', `${base}/practice/context`, { jobDescription: 'x'.repeat(8001) }))
          .statusCode,
      ).toBe(400);
    });

    it('builds the prompt for a practice task and refuses a task that is not a practice', async () => {
      const res = await callA('GET', `${base}/tasks/p1/practice/prompt`);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.persona.id).toBe('behavioral_interviewer');
      expect(body.prompt).toContain('Task p1');
      expect(body.prompt).toContain('===FEEDBACK===');
      expect(body.feedbackFormat).toContain('===END===');
      expect(body.inputs).toMatchObject({
        nextFocus: null,
        nextFocusFrom: null,
        topics: [],
        jobDescriptionIncluded: false,
      });
      const generic = (await callA('GET', `${base}/tasks/p4/practice/prompt`)).json();
      expect(generic.persona.id).toBe('generic_coach');

      expect((await callA('GET', `${base}/tasks/c1/practice/prompt`)).statusCode).toBe(422);
      expect(
        (await callA('POST', sessionsUrl('c1'), { id: S(1), channel: 'self' })).statusCode,
      ).toBe(422);
      expect((await callA('GET', `${base}/tasks/nope/practice/prompt`)).statusCode).toBe(404);
    });

    it('includes the job description, hides personal details and studied topics, and keeps the job description out of the stored prompt', async () => {
      await callA('PUT', `${base}/practice/context`, {
        jobDescription:
          'JOBDESC-MARKER Operations analyst. Contact Zebediah at zed.quill@example.com or +972 54 123 4567.',
      });
      // Time logged on another task this week becomes a topic.
      expect(
        (
          await callA('POST', `${base}/tasks/c1/logs`, {
            id: 'e0000000-0000-4000-8000-000000000001',
            date: '2026-11-01',
            hours: 1,
          })
        ).statusCode,
      ).toBe(201);

      const body = (await callA('GET', `${base}/tasks/p1/practice/prompt`)).json();
      expect(body.prompt).toContain('JOBDESC-MARKER');
      expect(body.prompt).not.toContain('zed.quill');
      expect(body.prompt).not.toContain('Zebediah');
      expect(body.prompt).not.toContain('972');
      expect(body.inputs.jobDescriptionIncluded).toBe(true);
      expect(body.inputs.redactions).toBeGreaterThanOrEqual(3);
      expect(body.inputs.topics).toEqual(['Task c1']);

      const created = await start('p1', S(1));
      expect(created.session.prompt).not.toContain('JOBDESC-MARKER');
      expect(created.session.prompt).toContain('Task c1');
      expect(created.session.inputs).toMatchObject({
        jobDescriptionIncluded: true,
        topicTaskIds: ['c1'],
      });
      // The job description exists in exactly one table.
      const stored = await rows(
        `select 1 from rnd.practice_sessions where prompt_used like '%JOBDESC-MARKER%'
           or prompt_inputs::text like '%JOBDESC-MARKER%'`,
      );
      expect(stored).toHaveLength(0);
    });

    it('uses the next focus of the last finished session of the same kind only', async () => {
      await start('p1', S(1));
      const done = await callA('POST', sessionUrl(S(1), '/feedback'), {
        text: BLOCK('6/10', 'FOCUS-ONE use numbers'),
        markDone: false,
      });
      expect(done.statusCode).toBe(201);

      const sameKind = (await callA('GET', `${base}/tasks/p2/practice/prompt`)).json();
      expect(sameKind.inputs.nextFocus).toBe('FOCUS-ONE use numbers');
      expect(sameKind.inputs.nextFocusFrom).toBe(S(1));
      expect(sameKind.prompt).toContain('FOCUS-ONE use numbers');

      const otherKind = (await callA('GET', `${base}/tasks/p3/practice/prompt`)).json();
      expect(otherKind.inputs.nextFocus).toBeNull();
      expect(otherKind.prompt).not.toContain('FOCUS-ONE');

      // A newer finished session replaces it; an abandoned or active one never counts.
      clock = new Date(NOW.getTime() + 3_600_000);
      await start('p2', S(2));
      expect(
        (await callA('GET', `${base}/tasks/p1/practice/prompt`)).json().inputs.nextFocusFrom,
      ).toBe(S(1));
      await callA('POST', sessionUrl(S(2), '/abandon'));
      await start('p2', S(3));
      await callA('POST', sessionUrl(S(3), '/feedback'), { text: BLOCK('8/10', 'FOCUS-TWO pace') });
      const latest = (await callA('GET', `${base}/tasks/p1/practice/prompt`)).json();
      expect(latest.inputs).toMatchObject({ nextFocus: 'FOCUS-TWO pace', nextFocusFrom: S(3) });

      // The new session stores which session its focus came from, not the text of the focus' source.
      const next = await start('p1', S(4));
      expect(next.session.inputs.nextFocusFromSession).toBe(S(3));
    });
  });

  describe('sessions', () => {
    it('creates a session, writes practice.started and returns the same session for a retry', async () => {
      const first = await callA('POST', sessionsUrl('p1'), { id: S(1), channel: 'external' });
      expect(first.statusCode).toBe(201);
      expect(first.json().session).toMatchObject({
        id: S(1),
        taskId: 'p1',
        kind: 'mock_interview',
        persona: 'behavioral_interviewer',
        channel: 'external',
        status: 'active',
        plannedMinutes: 60,
        endedAt: null,
      });
      expect(first.json().messages).toEqual([]);

      const again = await callA('POST', sessionsUrl('p1'), { id: S(1), channel: 'external' });
      expect(again.statusCode).toBe(200);
      expect(again.json().session.startedAt).toBe(first.json().session.startedAt);

      const events = await rows<{ payload: Record<string, unknown> }>(
        `select payload from rnd.events where type = 'practice.started'`,
      );
      expect(events).toHaveLength(1);
      expect(events[0]!.payload).toEqual({
        sessionId: S(1),
        taskId: 'p1',
        kind: 'mock_interview',
        channel: 'external',
      });
    });

    it('answers 409 for an id used for other data and for a second active session', async () => {
      await start('p1', S(1));
      const otherChannel = await callA('POST', sessionsUrl('p1'), { id: S(1), channel: 'self' });
      expect(otherChannel.statusCode).toBe(409);
      const otherTask = await callA('POST', sessionsUrl('p2'), { id: S(1), channel: 'external' });
      expect(otherTask.statusCode).toBe(409);

      const second = await callA('POST', sessionsUrl('p1'), { id: S(2), channel: 'external' });
      expect(second.statusCode).toBe(409);
      expect(second.json().error.code).toBe('practice_session_active');
      expect(second.json().error.message).toContain(S(1));

      // Another task is fine, and so is the same task once the first is over.
      await start('p2', S(3));
      await callA('POST', sessionUrl(S(1), '/abandon'));
      await start('p1', S(4));
    });

    it('lets only one of two simultaneous starts through', async () => {
      const headers = await asA();
      const [x, y] = await Promise.all([
        call('POST', sessionsUrl('p1'), headers, { id: S(1), channel: 'self' }),
        call('POST', sessionsUrl('p1'), headers, { id: S(2), channel: 'self' }),
      ]);
      expect([x.statusCode, y.statusCode].sort()).toEqual([201, 409]);
      expect(await rows(`select 1 from rnd.practice_sessions`)).toHaveLength(1);
    });

    it('refuses the in-app channel for now', async () => {
      const res = await callA('POST', sessionsUrl('p1'), { id: S(1), channel: 'in_app' });
      expect(res.statusCode).toBe(400);
    });

    it('shows a session with its feedback', async () => {
      await start('p1', S(1));
      const before = await callA('GET', sessionUrl(S(1)));
      expect(before.json()).toMatchObject({ messages: [], feedback: null });
      await callA('POST', sessionUrl(S(1), '/feedback'), { text: BLOCK('7/10') });
      const after = (await callA('GET', sessionUrl(S(1)))).json();
      expect(after.session.status).toBe('finished');
      expect(after.feedback).toMatchObject({ source: 'pasted_block', score: 7 });
    });
  });

  describe('pasted feedback', () => {
    it('saves a valid block, marks the task done only with markDone, logs hours and writes the event', async () => {
      await start('p1', S(1));
      clock = new Date(NOW.getTime() + 25 * 60_000);
      const res = await callA('POST', sessionUrl(S(1), '/feedback'), {
        text: BLOCK('7/10'),
        markDone: true,
        logHours: 0.5,
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.parsed).toBe(true);
      expect(body.replayed).toBe(false);
      expect(body.session.status).toBe('finished');
      expect(body.feedback).toMatchObject({
        source: 'pasted_block',
        score: 7,
        strengths: 'Clear structure and calm delivery',
        improve: 'Give numbers',
        nextFocus: 'Quantify the result of every story',
      });
      expect(body.task).toEqual({ status: 'done', doneHours: 0.5 });
      expect(body.loggedHours).toBe(0.5);

      expect(await taskRow('p1')).toMatchObject({ status: 'done', done_hours: 0.5 });
      const stored = await rows(`select source, score::float8 as score from rnd.practice_feedback`);
      expect(stored).toEqual([{ source: 'pasted_block', score: 7 }]);

      const logs = await rows<{ id: string; hours: string; date: string }>(
        `select id, hours::text, date::text from rnd.logs where task_id = 'p1'`,
      );
      expect(logs).toEqual([{ id: sessionLogId(S(1)), hours: '0.5', date: '2026-11-02' }]);

      const events = await rows<{ type: string; payload: Record<string, unknown> }>(
        `select type, payload from rnd.events where type like 'practice.%' order by created_at, id`,
      );
      expect(events.map((e) => e.type)).toEqual(['practice.started', 'practice.finished']);
      expect(events[1]!.payload).toEqual({
        sessionId: S(1),
        taskId: 'p1',
        kind: 'mock_interview',
        source: 'pasted_block',
        score: 7,
        minutes: 25,
        markedDone: true,
        loggedHours: 0.5,
      });
      expect(await rows(`select 1 from rnd.events where type = 'task.completed'`)).toHaveLength(1);
    });

    it('keeps plain text as free text with a 201 and no error', async () => {
      await start('p1', S(1));
      const text = 'I think the interview went fine, mostly. FREETEXT-MARKER';
      const res = await callA('POST', sessionUrl(S(1), '/feedback'), { text });
      expect(res.statusCode).toBe(201);
      expect(res.json().parsed).toBe(false);
      expect(res.json().feedback).toMatchObject({
        source: 'free_text',
        score: null,
        raw: text,
        nextFocus: '',
      });
      expect(res.json().session.status).toBe('finished');
      expect(await taskRow('p1')).toMatchObject({ status: 'pending', done_hours: 0 });
      // A free-text session gives no next focus to the next one.
      expect(
        (await callA('GET', `${base}/tasks/p2/practice/prompt`)).json().inputs.nextFocus,
      ).toBeNull();
    });

    it('leaves the task alone without markDone and moves it to in progress only when hours are logged', async () => {
      await start('p1', S(1));
      const res = await callA('POST', sessionUrl(S(1), '/feedback'), { text: BLOCK('9/10') });
      expect(res.statusCode).toBe(201);
      expect(res.json().task).toEqual({ status: 'pending', doneHours: 0 });
      expect(await taskRow('p1')).toMatchObject({ status: 'pending' });
      expect(await rows(`select 1 from rnd.logs`)).toHaveLength(0);

      await start('p2', S(2));
      const logged = await callA('POST', sessionUrl(S(2), '/feedback'), {
        text: BLOCK('9/10'),
        logHours: 1,
      });
      expect(logged.json().task).toEqual({ status: 'in_progress', doneHours: 1 });
    });

    it('is idempotent for the same text and options, and 409 for anything else', async () => {
      await start('p1', S(1));
      const payload = { text: BLOCK('7/10'), markDone: true, logHours: 1 };
      const first = await callA('POST', sessionUrl(S(1), '/feedback'), payload);
      expect(first.statusCode).toBe(201);
      const second = await callA('POST', sessionUrl(S(1), '/feedback'), payload);
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ replayed: true, parsed: true, loggedHours: 1 });

      expect(
        (await callA('POST', sessionUrl(S(1), '/feedback'), { ...payload, text: BLOCK('3/10') }))
          .statusCode,
      ).toBe(409);
      expect(
        (await callA('POST', sessionUrl(S(1), '/feedback'), { ...payload, markDone: false }))
          .statusCode,
      ).toBe(409);
      expect(
        (await callA('POST', sessionUrl(S(1), '/feedback'), { ...payload, logHours: 2 }))
          .statusCode,
      ).toBe(409);

      expect(await rows(`select 1 from rnd.practice_feedback`)).toHaveLength(1);
      expect(await rows(`select 1 from rnd.logs`)).toHaveLength(1);
      expect(await rows(`select 1 from rnd.events where type = 'practice.finished'`)).toHaveLength(
        1,
      );
      expect(await rows(`select 1 from rnd.events where type = 'task.completed'`)).toHaveLength(1);
    });

    it('handles two simultaneous identical submissions as one', async () => {
      await start('p1', S(1));
      const headers = await asA();
      const payload = { text: BLOCK('7/10'), markDone: true, logHours: 1 };
      const [x, y] = await Promise.all([
        call('POST', sessionUrl(S(1), '/feedback'), headers, payload),
        call('POST', sessionUrl(S(1), '/feedback'), headers, payload),
      ]);
      expect([x.statusCode, y.statusCode].sort()).toEqual([200, 201]);
      expect(await rows(`select 1 from rnd.logs`)).toHaveLength(1);
      expect(await rows(`select 1 from rnd.events where type = 'practice.finished'`)).toHaveLength(
        1,
      );
      expect(await taskRow('p1')).toMatchObject({ status: 'done', done_hours: 1 });
    });

    it('answers 409 for an abandoned session and for marking a skipped task done', async () => {
      await start('p1', S(1));
      await callA('POST', sessionUrl(S(1), '/abandon'));
      expect(
        (await callA('POST', sessionUrl(S(1), '/feedback'), { text: BLOCK('7/10') })).statusCode,
      ).toBe(409);

      await start('p2', S(2));
      await callA('POST', `${base}/tasks/p2/skip`);
      const res = await callA('POST', sessionUrl(S(2), '/feedback'), {
        text: BLOCK('7/10'),
        markDone: true,
      });
      expect(res.statusCode).toBe(409);
      expect(await taskRow('p2')).toMatchObject({ status: 'skipped' });
      expect((await callA('GET', sessionUrl(S(2)))).json().session.status).toBe('active');
    });
  });

  describe('finish and abandon', () => {
    it('scores a self-check from the task’s steps and leaves the status unchanged without markDone', async () => {
      await start('p1', S(1), 'self');
      const res = await callA('POST', sessionUrl(S(1), '/finish'), {
        markDone: false,
        rubric: { checkedSteps: [0, 1, 1] },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().feedback).toMatchObject({
        source: 'self_rubric',
        score: 5,
        nextFocus: 'Review answers',
        raw: null,
      });
      expect(res.json().task).toEqual({ status: 'pending', doneHours: 0 });
      expect(await taskRow('p1')).toMatchObject({ status: 'pending' });
      expect(await rows(`select 1 from rnd.logs`)).toHaveLength(0);
      expect(await rows(`select 1 from rnd.events where type = 'task.completed'`)).toHaveLength(0);
      // The self-check's next focus feeds the next prompt of the kind.
      expect((await callA('GET', `${base}/tasks/p2/practice/prompt`)).json().inputs.nextFocus).toBe(
        'Review answers',
      );
    });

    it('marks the task done when asked, uses generic steps for a task without steps, and checks the ticked steps', async () => {
      await start('p4', S(1), 'self');
      const bad = await callA('POST', sessionUrl(S(1), '/finish'), {
        markDone: true,
        rubric: { checkedSteps: [4] },
      });
      expect(bad.statusCode).toBe(422);
      expect(await taskRow('p4')).toMatchObject({ status: 'pending' });

      const res = await callA('POST', sessionUrl(S(1), '/finish'), {
        markDone: true,
        logHours: 1,
        rubric: { checkedSteps: [0, 1, 2, 3] },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().feedback.score).toBe(10);
      expect(res.json().task.status).toBe('done');
      expect(await taskRow('p4')).toMatchObject({ status: 'done' });
    });

    it('turns an entered score into 0 to 10 and refuses a rubric together with a score', async () => {
      await start('p1', S(1), 'self');
      const both = await callA('POST', sessionUrl(S(1), '/finish'), {
        markDone: false,
        rubric: { checkedSteps: [] },
        enteredScore: { score: 1, max: 2 },
      });
      expect(both.statusCode).toBe(400);
      const res = await callA('POST', sessionUrl(S(1), '/finish'), {
        markDone: false,
        enteredScore: { score: 34, max: 40 },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().feedback).toMatchObject({ source: 'self_rubric', score: 8.5 });
    });

    it('finishes without any feedback and is idempotent', async () => {
      await start('p1', S(1), 'self');
      const body = { markDone: false, logHours: 2 };
      const first = await callA('POST', sessionUrl(S(1), '/finish'), body);
      expect(first.statusCode).toBe(201);
      expect(first.json().feedback).toBeNull();
      const again = await callA('POST', sessionUrl(S(1), '/finish'), body);
      expect(again.statusCode).toBe(200);
      expect(again.json().replayed).toBe(true);
      expect(
        (await callA('POST', sessionUrl(S(1), '/finish'), { markDone: true, logHours: 2 }))
          .statusCode,
      ).toBe(409);
      expect(await rows(`select 1 from rnd.logs`)).toHaveLength(1);
      expect(await rows(`select 1 from rnd.practice_feedback`)).toHaveLength(0);
      expect(await taskRow('p1')).toMatchObject({ status: 'in_progress', done_hours: 2 });
    });

    it('answers 409 for a different feedback on a finished session', async () => {
      await start('p1', S(1), 'self');
      await callA('POST', sessionUrl(S(1), '/finish'), {
        markDone: false,
        rubric: { checkedSteps: [0] },
      });
      const other = await callA('POST', sessionUrl(S(1), '/finish'), {
        markDone: false,
        rubric: { checkedSteps: [0, 1] },
      });
      expect(other.statusCode).toBe(409);
      const paste = await callA('POST', sessionUrl(S(1), '/feedback'), { text: BLOCK('7/10') });
      expect(paste.statusCode).toBe(409);
    });

    it('validates log hours', async () => {
      await start('p1', S(1), 'self');
      expect(
        (await callA('POST', sessionUrl(S(1), '/finish'), { markDone: false, logHours: 13 }))
          .statusCode,
      ).toBe(400);
      expect(
        (await callA('POST', sessionUrl(S(1), '/finish'), { markDone: false, logHours: -1 }))
          .statusCode,
      ).toBe(400);
      expect((await callA('POST', sessionUrl(S(1), '/finish'), {})).statusCode).toBe(400);
      // 0 and null log nothing.
      const zero = await callA('POST', sessionUrl(S(1), '/finish'), {
        markDone: false,
        logHours: 0,
      });
      expect(zero.statusCode).toBe(201);
      expect(zero.json().loggedHours).toBeNull();
      expect(await rows(`select 1 from rnd.logs`)).toHaveLength(0);
    });

    it('abandons without logging or touching the task, idempotently, and never reopens a finished session', async () => {
      await start('p1', S(1));
      const res = await callA('POST', sessionUrl(S(1), '/abandon'));
      expect(res.statusCode).toBe(200);
      expect(res.json().session).toMatchObject({ status: 'abandoned' });
      expect(res.json().session.endedAt).not.toBeNull();
      expect((await callA('POST', sessionUrl(S(1), '/abandon'))).statusCode).toBe(200);
      expect(await taskRow('p1')).toMatchObject({ status: 'pending', done_hours: 0 });
      expect(await rows(`select 1 from rnd.logs`)).toHaveLength(0);
      expect(await rows(`select 1 from rnd.events where type = 'practice.finished'`)).toHaveLength(
        0,
      );
      expect(
        (await callA('POST', sessionUrl(S(1), '/finish'), { markDone: true })).statusCode,
      ).toBe(409);

      await start('p2', S(2));
      await callA('POST', sessionUrl(S(2), '/finish'), { markDone: false });
      expect((await callA('POST', sessionUrl(S(2), '/abandon'))).statusCode).toBe(409);
      expect((await callA('GET', sessionUrl(S(2)))).json().session.status).toBe('finished');
    });

    it('does not move a finished task back to active when a later session is finished without markDone', async () => {
      await start('p1', S(1), 'self');
      await callA('POST', sessionUrl(S(1), '/finish'), { markDone: true });
      expect(await taskRow('p1')).toMatchObject({ status: 'done' });
      await start('p1', S(2), 'self');
      const res = await callA('POST', sessionUrl(S(2), '/finish'), { markDone: false });
      expect(res.statusCode).toBe(201);
      expect(res.json().task.status).toBe('done');
      expect(await taskRow('p1')).toMatchObject({ status: 'done' });
    });
  });

  describe('history, trends and events', () => {
    it('lists finished sessions without text and computes trends per kind', async () => {
      const finish = async (task: string, id: string, score: string, at: Date) => {
        clock = at;
        await start(task, id);
        clock = new Date(at.getTime() + 20 * 60_000);
        await callA('POST', sessionUrl(id, '/feedback'), { text: BLOCK(score) });
      };
      await finish('p1', S(1), '5/10', new Date('2026-11-01T08:00:00Z'));
      await finish('p2', S(2), '8/10', new Date('2026-11-02T08:00:00Z'));
      await finish('p3', S(3), '6/10', new Date('2026-11-02T09:00:00Z'));
      clock = new Date('2026-11-02T11:00:00Z');
      await start('p1', S(4)); // active: not in history
      await start('p4', S(5), 'self');
      await callA('POST', sessionUrl(S(5), '/finish'), { markDone: false }); // finished, no score
      await callA('POST', sessionUrl(S(4), '/abandon'));

      const history = (await callA('GET', `${base}/practice/history`)).json();
      expect(history.sessions.map((s: { id: string }) => s.id)).toEqual([S(5), S(3), S(2), S(1)]);
      expect(history.sessions[1]).toMatchObject({
        taskId: 'p3',
        kind: 'home_assignment',
        channel: 'external',
        minutes: 20,
        score: 6,
        source: 'pasted_block',
      });
      expect(history.sessions[0]).toMatchObject({ score: null, source: null });
      expect(JSON.stringify(history)).not.toContain('Clear structure');

      const kind = (await callA('GET', `${base}/practice/history?kind=mock_interview`)).json();
      expect(kind.sessions.map((s: { id: string }) => s.id)).toEqual([S(2), S(1)]);
      const range = (
        await callA('GET', `${base}/practice/history?from=2026-11-02&to=2026-11-02&limit=1`)
      ).json();
      expect(range.sessions.map((s: { id: string }) => s.id)).toEqual([S(5)]);
      expect((await callA('GET', `${base}/practice/history?limit=201`)).statusCode).toBe(400);
      expect(
        (await callA('GET', `${base}/practice/history?from=2026-11-03&to=2026-11-02`)).statusCode,
      ).toBe(400);

      const trends = (await callA('GET', `${base}/practice/trends`)).json();
      expect(trends.kinds).toEqual([
        {
          kind: 'home_assignment',
          points: [{ date: '2026-11-02', score: 6, source: 'pasted_block' }],
          last: 6,
          average: 6,
          delta: null,
        },
        {
          kind: 'mock_interview',
          points: [
            { date: '2026-11-01', score: 5, source: 'pasted_block' },
            { date: '2026-11-02', score: 8, source: 'pasted_block' },
          ],
          last: 8,
          average: 6.5,
          delta: 3,
        },
      ]);
      const ranged = (await callA('GET', `${base}/practice/trends?from=2026-11-02`)).json();
      expect(ranged.kinds.map((k: { kind: string }) => k.kind)).toEqual([
        'home_assignment',
        'mock_interview',
      ]);
      expect(ranged.kinds[1].points).toHaveLength(1);
    });

    it('writes events that carry no text', async () => {
      await callA('PUT', `${base}/practice/context`, {
        jobDescription: 'EVENT-JD-MARKER we need an analyst',
      });
      await start('p1', S(1));
      await callA('POST', sessionUrl(S(1), '/feedback'), {
        text: BLOCK('7/10', 'EVENT-FOCUS-MARKER'),
        markDone: true,
        logHours: 1,
      });
      const events = await rows<{ type: string; payload: Record<string, unknown> }>(
        `select type, payload from rnd.events where type like 'practice.%'`,
      );
      expect(events).toHaveLength(2);
      for (const e of events) {
        const text = JSON.stringify(e.payload);
        for (const marker of [
          'EVENT-JD-MARKER',
          'EVENT-FOCUS-MARKER',
          'Clear structure',
          'Give numbers',
        ]) {
          expect(text).not.toContain(marker);
        }
        for (const value of Object.values(e.payload)) {
          expect(['string', 'number', 'boolean', 'object']).toContain(typeof value);
        }
      }
      expect(
        Object.keys(events.find((e) => e.type === 'practice.finished')!.payload).sort(),
      ).toEqual([
        'kind',
        'loggedHours',
        'markedDone',
        'minutes',
        'score',
        'sessionId',
        'source',
        'taskId',
      ]);
    });

    it('never logs the job description or pasted feedback', async () => {
      const lines: string[] = [];
      const quiet = buildApp(
        testConfig({ appEnv: 'rnd', rateLimitPerMinute: 100_000, logLevel: 'trace' }),
        {
          verifier: createSupabaseVerifier({ issuer: ISSUER, keys: keys.keys }),
          db,
          now: () => clock,
          logStream: { write: (line) => void lines.push(line) },
        },
      );
      await quiet.ready();
      try {
        const headers = await asA();
        const send = (method: Method, url: string, payload: unknown) =>
          quiet.inject({ method, url: `/api/v1${url}`, headers, payload: payload as object });
        await send('PUT', `${base}/practice/context`, { jobDescription: 'LOG-JD-MARKER' });
        await send('POST', sessionsUrl('p1'), { id: S(1), channel: 'external' });
        await send('POST', sessionUrl(S(1), '/feedback'), {
          text: BLOCK('7/10', 'LOG-FOCUS-MARKER'),
        });
        // A rejected body must not echo its text either.
        await send('PUT', `${base}/practice/context`, { jobDescription: 'LOG-BAD-MARKER\u0000' });
      } finally {
        await quiet.close();
      }
      const all = lines.join('\n');
      expect(all.length).toBeGreaterThan(0);
      for (const marker of [
        'LOG-JD-MARKER',
        'LOG-FOCUS-MARKER',
        'LOG-BAD-MARKER',
        'Clear structure',
      ]) {
        expect(all).not.toContain(marker);
      }
    });
  });
});
