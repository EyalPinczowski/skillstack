import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createDatabase, type Database } from '../src/db/database';
import type { z } from 'zod';
import { errorResponseSchema } from '../src/errors';
import type { progressView } from '../src/modules/tasks/schemas';
import { createSupabaseVerifier } from '../src/modules/accounts/token-verifier';
import { acceptCurrentLegal, dbAvailable, prepareDatabase, type TestDb } from './db-helpers';
import { testConfig } from './helpers';
import { ISSUER, makeTestKeys, type TestKeys } from './tokens';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PLAN_A = 'a0000000-0000-4000-8000-000000000001';
const PLAN_A2 = 'a0000000-0000-4000-8000-000000000002';
const PLAN_B = 'b0000000-0000-4000-8000-000000000001';
const LOG1 = 'c0000000-0000-4000-8000-000000000001';
const LOG2 = 'c0000000-0000-4000-8000-000000000002';
const LOG3 = 'c0000000-0000-4000-8000-000000000003';

type Progress = z.infer<typeof progressView>;
type Method = 'GET' | 'PATCH' | 'POST';

describe.skipIf(!dbAvailable)('tasks and logs (real Postgres, locally signed tokens)', () => {
  let testDb: TestDb;
  let db: Database;
  let keys: TestKeys;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    testDb = await prepareDatabase();
    keys = await makeTestKeys();
    db = createDatabase({ connectionString: testDb.appUrl('rnd'), appEnv: 'rnd' });
    app = buildApp(testConfig({ appEnv: 'rnd', rateLimitPerMinute: 100_000 }), {
      verifier: createSupabaseVerifier({ issuer: ISSUER, keys: keys.keys }),
      db,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  /** Fixtures go in with direct SQL as the superuser, never through the plans API. */
  beforeEach(async () => {
    await testDb.admin(async (c) => {
      await c.query('drop trigger if exists fail_logged on rnd.events');
      await c.query('delete from rnd.app_users');
      await c.query('delete from rnd.allowed_emails');
      await c.query(
        `insert into rnd.allowed_emails (email) values ('a@example.com'), ('b@example.com')`,
      );
      await c.query(
        `insert into rnd.app_users (id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')`,
        [A, B],
      );
      const plan = (user: string, id: string) =>
        c.query(
          `insert into rnd.plans (user_id, id, created_from, name, start_date)
           values ($1, $2, 'builder', 'Plan', '2026-11-01')`,
          [user, id],
        );
      await acceptCurrentLegal(c, [A, B]);
      await plan(A, PLAN_A);
      await plan(A, PLAN_A2);
      await plan(B, PLAN_B);
      const task = (
        user: string,
        planId: string,
        id: string,
        order: number,
        o: { type?: string; est?: number; deps?: string[]; cert?: boolean } = {},
      ) =>
        c.query(
          `insert into rnd.tasks (user_id, plan_id, id, title, type, est_hours, sort_order,
             depends_on, is_certificate, certificate_name)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            user,
            planId,
            id,
            `Task ${id}`,
            o.type ?? 'course',
            o.est ?? 3,
            order,
            o.deps ?? [],
            o.cert ?? false,
            o.cert ? 'Cert X' : null,
          ],
        );
      await task(A, PLAN_A, 't1', 0, { est: 3 });
      await task(A, PLAN_A, 't2', 1, { est: 2, deps: ['t1'] });
      await task(A, PLAN_A, 't3', 2, { type: 'cert_exam', est: 1, cert: true });
      await task(A, PLAN_A, 't4', 3, { type: 'practice', est: 2 });
      await task(A, PLAN_A2, 'other', 0);
      await task(B, PLAN_B, 't1', 0);
    });
  });

  const as = async (sub: string, email: string) => ({
    authorization: `Bearer ${await keys.sign({ sub, email })}`,
  });
  const asA = () => as(A, 'a@example.com');
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

  const T = (id = 't1', plan = PLAN_A) => `/plans/${plan}/tasks/${id}`;
  const logBody = (over: Record<string, unknown> = {}) => ({
    id: LOG1,
    date: '2026-11-03',
    hours: 1.5,
    ...over,
  });

  const rows = <R = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    testDb.admin(async (c) => (await c.query(sql, params)).rows as R[]);
  const taskRow = async (id = 't1', user = A, plan = PLAN_A) =>
    (
      await rows(
        `select status, done_hours::float8 as done_hours, title from rnd.tasks
         where user_id = $1 and plan_id = $2 and id = $3`,
        [user, plan, id],
      )
    )[0]!;
  const eventTypes = async () =>
    (await rows<{ type: string }>(`select type from rnd.events order by type`)).map((r) => r.type);

  describe('authentication', () => {
    it.each<[Method, string, unknown?]>([
      ['GET', `/plans/${PLAN_A}/tasks`],
      ['GET', `/plans/${PLAN_A}/tasks/t1`],
      ['PATCH', `/plans/${PLAN_A}/tasks/t1`, { title: 'x' }],
      ['POST', `/plans/${PLAN_A}/tasks/t1/logs`, { id: LOG1, date: '2026-11-03', hours: 1 }],
      ['POST', `/plans/${PLAN_A}/tasks/t1/complete`],
      ['GET', `/plans/${PLAN_A}/progress`],
      ['GET', `/plans/${PLAN_A}/logs`],
    ])('%s %s without a token answers 401', async (m, u, body) => {
      const res = await call(m, u, {}, body);
      expect(res.statusCode).toBe(401);
      expect(errorResponseSchema.parse(res.json()).error.code).toBe('unauthorized');
    });
  });

  describe('reading', () => {
    it('lists a plan tasks in order, with the shared task shape', async () => {
      const res = await call('GET', `/plans/${PLAN_A}/tasks`, await asA());
      expect(res.statusCode).toBe(200);
      const body = res.json() as { tasks: Array<Record<string, unknown>> };
      expect(body.tasks.map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4']);
      expect(body.tasks[1]).toMatchObject({
        id: 't2',
        type: 'course',
        estHours: 2,
        doneHours: 0,
        status: 'pending',
        order: 1,
        dependsOn: ['t1'],
        splittable: true,
        source: 'manual',
      });
      expect(JSON.stringify(body)).not.toContain(A);
      expect(body.tasks[0]).not.toHaveProperty('userId');
    });

    it('reads one task', async () => {
      const res = await call('GET', T('t3'), await asA());
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        id: 't3',
        isCertificate: true,
        certificateName: 'Cert X',
      });
    });

    it('answers 404 for an unknown task and for a task in a different plan', async () => {
      expect((await call('GET', T('nope'), await asA())).statusCode).toBe(404);
      expect((await call('GET', T('other'), await asA())).statusCode).toBe(404);
    });

    it('answers 400 for a plan id that is not a UUID', async () => {
      const res = await call('GET', '/plans/not-a-uuid/tasks', await asA());
      expect(res.statusCode).toBe(400);
    });
  });

  describe('another user (no existence leak)', () => {
    const same = async (method: Method, url: string, payload?: unknown) => {
      const mine = await call(method, url, await asB(), payload);
      const missing = await call(
        method,
        url.replace(PLAN_A, 'a0000000-0000-4000-8000-0000000000ff'),
        await asB(),
        payload,
      );
      return { mine, missing };
    };

    it.each<[Method, string, unknown?]>([
      ['GET', `/plans/${PLAN_A}/tasks`],
      ['GET', `/plans/${PLAN_A}/tasks/t1`],
      ['PATCH', `/plans/${PLAN_A}/tasks/t1`, { title: 'hacked' }],
      ['POST', `/plans/${PLAN_A}/tasks/t1/logs`, { id: LOG1, date: '2026-11-03', hours: 1 }],
      ['POST', `/plans/${PLAN_A}/tasks/t1/complete`],
      ['POST', `/plans/${PLAN_A}/tasks/t1/reopen`],
      ['POST', `/plans/${PLAN_A}/tasks/t1/skip`],
      ['GET', `/plans/${PLAN_A}/progress`],
      ['GET', `/plans/${PLAN_A}/logs`],
    ])('%s %s answers the same 404 as for a plan that does not exist', async (m, u, body) => {
      const { mine, missing } = await same(m, u, body);
      expect(mine.statusCode).toBe(404);
      expect(missing.statusCode).toBe(404);
      const strip = (r: typeof mine) => {
        const e = (r.json() as { error: { code: string; message: string } }).error;
        return { code: e.code, message: e.message };
      };
      expect(strip(mine)).toEqual(strip(missing));
    });

    it('changed nothing for the owner', async () => {
      await call('PATCH', T(), await asB(), { title: 'hacked' });
      await call('POST', `${T()}/logs`, await asB(), logBody());
      await call('POST', `${T()}/complete`, await asB());
      expect(await taskRow()).toMatchObject({ status: 'pending', done_hours: 0, title: 'Task t1' });
      expect(await rows('select 1 from rnd.logs')).toHaveLength(0);
      expect(await rows('select 1 from rnd.events')).toHaveLength(0);
    });

    it('cannot reuse the owner log id to learn it exists (own log is created)', async () => {
      await call('POST', `${T()}/logs`, await asA(), logBody());
      const res = await call('POST', `/plans/${PLAN_B}/tasks/t1/logs`, await asB(), logBody());
      expect(res.statusCode).toBe(201);
      const stored = await rows(`select user_id from rnd.logs order by user_id`);
      expect(stored.map((r) => r.user_id)).toEqual([A, B]);
    });
  });

  describe('PATCH (the user own edit)', () => {
    it('edits the editable fields', async () => {
      const res = await call('PATCH', T('t2'), await asA(), {
        title: 'New title',
        notes: 'remember this',
        estHours: 4.5,
        order: 9,
        dependsOn: ['t1', 't4'],
        notBefore: '2026-12-01',
        splittable: false,
        url: 'https://example.com/course',
        provider: 'Example',
        howToSteps: ['one', 'two'],
        lessons: [{ title: 'L1', estMinutes: 30 }],
        practiceKind: 'quiz',
        promptTemplate: 'Do {x}',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        id: 't2',
        title: 'New title',
        notes: 'remember this',
        estHours: 4.5,
        order: 9,
        dependsOn: ['t1', 't4'],
        notBefore: '2026-12-01',
        splittable: false,
        url: 'https://example.com/course',
        provider: 'Example',
        howToSteps: ['one', 'two'],
        practiceKind: 'quiz',
      });
      const get = await call('GET', T('t2'), await asA());
      expect(get.json()).toMatchObject({ title: 'New title', order: 9 });
    });

    it('clears optional fields with null', async () => {
      await call('PATCH', T(), await asA(), { notes: 'x', provider: 'P' });
      const res = await call('PATCH', T(), await asA(), { notes: null, provider: null });
      expect(res.statusCode).toBe(200);
      expect(res.json()).not.toHaveProperty('notes');
      expect(res.json()).not.toHaveProperty('provider');
    });

    it.each([
      ['status', { status: 'done' }],
      ['doneHours', { doneHours: 99 }],
      ['done_hours', { done_hours: 99 }],
      ['source', { source: 'import' }],
      ['id', { id: 'zzz' }],
      ['userId', { userId: B }],
      ['user_id', { user_id: B }],
      ['planId', { planId: PLAN_B }],
      ['plan_id', { plan_id: PLAN_B }],
      ['externalRef', { externalRef: 'x' }],
      ['type', { type: 'admin' }],
    ])('rejects %s in the body and changes nothing', async (_name, body) => {
      const res = await call('PATCH', T(), await asA(), { title: 'ok', ...body });
      expect(res.statusCode).toBe(400);
      expect(errorResponseSchema.parse(res.json()).error.code).toBe('validation_error');
      expect(await taskRow()).toMatchObject({ status: 'pending', done_hours: 0, title: 'Task t1' });
    });

    it('rejects an empty patch and invalid values', async () => {
      const bad: unknown[] = [
        {},
        { title: '' },
        { estHours: 0 },
        { estHours: 501 },
        { order: -1 },
        { order: 1.5 },
        { url: 'not a url' },
        { notBefore: '2026-13-40' },
        { dependsOn: [''] },
      ];
      for (const body of bad) {
        const res = await call('PATCH', T(), await asA(), body);
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
      }
    });

    it('rejects a dependency cycle (direct and indirect)', async () => {
      // t2 already depends on t1, so t1 -> t2 closes a loop.
      const direct = await call('PATCH', T('t1'), await asA(), { dependsOn: ['t2'] });
      expect(direct.statusCode).toBe(422);
      await call('PATCH', T('t4'), await asA(), { dependsOn: ['t2'] });
      const indirect = await call('PATCH', T('t1'), await asA(), { dependsOn: ['t4'] });
      expect(indirect.statusCode).toBe(422);
      expect(errorResponseSchema.parse(indirect.json()).error.code).toBe('unprocessable');
      const t1 = await rows(`select depends_on from rnd.tasks where plan_id = $1 and id = 't1'`, [
        PLAN_A,
      ]);
      expect(t1[0]!.depends_on).toEqual([]);
    });

    it('rejects a task depending on itself', async () => {
      const res = await call('PATCH', T('t1'), await asA(), { dependsOn: ['t1'] });
      expect(res.statusCode).toBe(422);
    });

    it('rejects a dependency on a task that is not in the plan (other plan or other user)', async () => {
      expect((await call('PATCH', T(), await asA(), { dependsOn: ['other'] })).statusCode).toBe(
        422,
      );
      expect((await call('PATCH', T(), await asA(), { dependsOn: ['ghost'] })).statusCode).toBe(
        422,
      );
      // B's plan has a t1; A's t4 depending on a B-only id must fail as well.
      await testDb.admin((c) =>
        c.query(
          `insert into rnd.tasks (user_id, plan_id, id, title, type, est_hours, sort_order)
           values ($1, $2, 'only-b', 'x', 'course', 1, 5)`,
          [B, PLAN_B],
        ),
      );
      expect(
        (await call('PATCH', T('t4'), await asA(), { dependsOn: ['only-b'] })).statusCode,
      ).toBe(422);
    });

    it('rejects an estimate that would break an anchor (shared task rules)', async () => {
      await testDb.admin((c) =>
        c.query(
          `update rnd.tasks set is_anchor = true, anchor_date = '2026-12-01',
             anchor_start_time = '20:00', est_hours = 1 where plan_id = $1 and id = 't3'`,
          [PLAN_A],
        ),
      );
      const res = await call('PATCH', T('t3'), await asA(), { estHours: 5 });
      expect(res.statusCode).toBe(422);
    });

    it('leaves status and done_hours alone when editing a task that has logs', async () => {
      await call('POST', `${T()}/logs`, await asA(), logBody());
      await call('PATCH', T(), await asA(), { title: 'renamed', estHours: 1 });
      expect(await taskRow()).toMatchObject({
        status: 'in_progress',
        done_hours: 1.5,
        title: 'renamed',
      });
    });

    it('does not deadlock with a log being written for the same task (v0.2 review)', async () => {
      // A log write locks the task row first and then, through the foreign keys of `logs` and
      // `events`, takes a KEY SHARE lock on the plan row. An edit that holds the plan row with
      // FOR UPDATE while it waits for the task row would close the loop.
      await testDb.admin(async (c) => {
        await c.query('begin');
        await c.query(
          `select 1 from rnd.tasks where user_id = $1 and plan_id = $2 and id = 't1' for update`,
          [A, PLAN_A],
        );
        const me = (await c.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!;
        const patch = call('PATCH', T(), await asA(), { title: 'edited meanwhile' });
        // Wait until the edit's backend is queued on a lock held by this connection. Matching the
        // blocker keeps parallel tests and unrelated waiters out of the check.
        let queued = false;
        for (let i = 0; i < 100 && !queued; i++) {
          const [w] = await rows<{ n: number }>(
            `select count(*)::int as n from pg_stat_activity
             where wait_event_type = 'Lock' and $1 = any (pg_blocking_pids(pid))`,
            [me.pid],
          );
          queued = w!.n > 0;
          if (!queued) await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (!queued) {
          await c.query('rollback');
          await patch.catch(() => undefined);
          expect.fail(
            'the PATCH never queued behind the task row: the interleaving did not happen',
          );
        }
        await c.query(`set local lock_timeout = '3s'`);
        // What the log insert does next (foreign key check on the plan row).
        await c.query(`select 1 from rnd.plans where user_id = $1 and id = $2 for key share`, [
          A,
          PLAN_A,
        ]);
        await c.query('commit');
        expect((await patch).statusCode).toBe(200);
      });
      expect(await taskRow()).toMatchObject({ title: 'edited meanwhile' });
    });
  });

  describe('POST logs', () => {
    it('adds to done hours that came with an imported plan instead of dropping them', async () => {
      // An imported task can carry doneHours without any log rows (the plan file format allows it).
      await testDb.admin((c) =>
        c.query(
          `update rnd.tasks set done_hours = 2 where user_id = $1 and plan_id = $2 and id = 't1'`,
          [A, PLAN_A],
        ),
      );
      const res = await call('POST', `${T()}/logs`, await asA(), logBody({ hours: 0.5 }));
      expect(res.statusCode).toBe(201);
      expect((res.json() as { task: { doneHours: number } }).task.doneHours).toBe(2.5);
      expect(await taskRow()).toMatchObject({ done_hours: 2.5 });
      // A retry of the same log adds nothing.
      await call('POST', `${T()}/logs`, await asA(), logBody({ hours: 0.5 }));
      expect(await taskRow()).toMatchObject({ done_hours: 2.5 });
    });

    it('creates a log, recomputes done_hours, starts the task and writes both events', async () => {
      const res = await call('POST', `${T()}/logs`, await asA(), logBody({ note: 'n', score: 80 }));
      expect(res.statusCode).toBe(201);
      const body = res.json() as {
        log: Record<string, unknown>;
        task: Record<string, unknown>;
        suggestDone: boolean;
      };
      expect(body.log).toMatchObject({
        id: LOG1,
        taskId: 't1',
        planId: PLAN_A,
        date: '2026-11-03',
        hours: 1.5,
        score: 80,
        note: 'n',
      });
      expect(body.log).not.toHaveProperty('userId');
      expect(body.task).toMatchObject({ status: 'in_progress', doneHours: 1.5 });
      expect(body.suggestDone).toBe(false);
      expect(await taskRow()).toMatchObject({ status: 'in_progress', done_hours: 1.5 });
      expect(await eventTypes()).toEqual(['task.logged', 'task.started']);
      const events = await rows(`select user_id, plan_id, payload from rnd.events`);
      for (const e of events) {
        expect(e.user_id).toBe(A);
        expect(e.plan_id).toBe(PLAN_A);
      }
    });

    it('writes task.started only on the first log', async () => {
      await call('POST', `${T()}/logs`, await asA(), logBody());
      await call('POST', `${T()}/logs`, await asA(), logBody({ id: LOG2, hours: 0.5 }));
      expect(await eventTypes()).toEqual(['task.logged', 'task.logged', 'task.started']);
      expect(await taskRow()).toMatchObject({ done_hours: 2 });
    });

    it('is idempotent by id: a retry returns the same row, no second log, no more events', async () => {
      const first = await call('POST', `${T()}/logs`, await asA(), logBody());
      const retry = await call('POST', `${T()}/logs`, await asA(), logBody());
      expect(first.statusCode).toBe(201);
      expect(retry.statusCode).toBe(200);
      expect((retry.json() as { log: unknown }).log).toEqual(
        (first.json() as { log: unknown }).log,
      );
      expect(await rows('select 1 from rnd.logs')).toHaveLength(1);
      expect(await taskRow()).toMatchObject({ done_hours: 1.5 });
      expect(await eventTypes()).toEqual(['task.logged', 'task.started']);
    });

    it('keeps done_hours equal to the sum of logs after adds and retries', async () => {
      const plan: Array<[string, number]> = [
        [LOG1, 0.25],
        [LOG2, 1],
        [LOG3, 0.75],
        [LOG2, 1],
        [LOG1, 0.25],
      ];
      for (const [id, hours] of plan) {
        await call('POST', `${T()}/logs`, await asA(), logBody({ id, hours }));
        const [sum] = await rows<{ s: number }>(
          `select coalesce(sum(hours), 0)::float8 as s from rnd.logs where task_id = 't1'`,
        );
        expect((await taskRow()).done_hours).toBe(sum!.s);
      }
      expect((await taskRow()).done_hours).toBe(2);
    });

    it('answers 409 when the same id comes with a different payload, and changes nothing', async () => {
      await call('POST', `${T()}/logs`, await asA(), logBody());
      for (const change of [
        { hours: 2 },
        { date: '2026-11-04' },
        { note: 'other' },
        { score: 1 },
      ]) {
        const res = await call('POST', `${T()}/logs`, await asA(), logBody(change));
        expect(res.statusCode, JSON.stringify(change)).toBe(409);
        expect(errorResponseSchema.parse(res.json()).error.code).toBe('conflict');
      }
      // Same id against another task of the same user.
      const other = await call('POST', `${T('t2')}/logs`, await asA(), logBody());
      expect(other.statusCode).toBe(409);
      expect(await taskRow()).toMatchObject({ done_hours: 1.5 });
      expect(await taskRow('t2')).toMatchObject({ done_hours: 0, status: 'pending' });
      expect(await rows('select 1 from rnd.logs')).toHaveLength(1);
    });

    it('never marks a task done on its own: over the estimate it stays in_progress and suggests done', async () => {
      const res = await call('POST', `${T('t3')}/logs`, await asA(), logBody({ hours: 1 }));
      const body = res.json() as { task: { status: string }; suggestDone: boolean };
      expect(body.task.status).toBe('in_progress');
      expect(body.suggestDone).toBe(true);
      const over = await call(
        'POST',
        `${T('t3')}/logs`,
        await asA(),
        logBody({ id: LOG2, hours: 5 }),
      );
      expect((over.json() as { suggestDone: boolean }).suggestDone).toBe(true);
      expect(await taskRow('t3')).toMatchObject({ status: 'in_progress', done_hours: 6 });
      expect(await eventTypes()).not.toContain('task.completed');
      expect(await eventTypes()).not.toContain('certificate.earned');
    });

    it('does not suggest done for a task that is already done', async () => {
      await call('POST', `${T('t3')}/complete`, await asA());
      const res = await call('POST', `${T('t3')}/logs`, await asA(), logBody({ hours: 2 }));
      expect(res.statusCode).toBe(201);
      expect((res.json() as { suggestDone: boolean }).suggestDone).toBe(false);
      expect(await taskRow('t3')).toMatchObject({ status: 'done', done_hours: 2 });
    });

    it('ignores nothing silently: user_id, plan_id and task_id in the body are rejected', async () => {
      for (const extra of [{ userId: B }, { user_id: B }, { planId: PLAN_B }, { taskId: 't2' }]) {
        const res = await call('POST', `${T()}/logs`, await asA(), logBody(extra));
        expect(res.statusCode, JSON.stringify(extra)).toBe(400);
      }
      expect(await rows('select 1 from rnd.logs')).toHaveLength(0);
    });

    it('takes the owner only from the token (the log row carries the token user)', async () => {
      await call('POST', `${T()}/logs`, await asA(), logBody());
      const [row] = await rows(`select user_id, plan_id, task_id from rnd.logs`);
      expect(row).toEqual({ user_id: A, plan_id: PLAN_A, task_id: 't1' });
    });

    it('validates hours: 0 < hours <= 24', async () => {
      const bad = [0, -1, 24.01, 25, '2', null, Number.NaN];
      for (const hours of bad) {
        const res = await call('POST', `${T()}/logs`, await asA(), logBody({ hours }));
        expect(res.statusCode, String(hours)).toBe(400);
      }
      expect(
        (await call('POST', `${T()}/logs`, await asA(), logBody({ hours: 24 }))).statusCode,
      ).toBe(201);
      expect(
        (await call('POST', `${T()}/logs`, await asA(), logBody({ id: LOG2, hours: 0.01 })))
          .statusCode,
      ).toBe(201);
    });

    it('validates the date, the id and the optional fields', async () => {
      const bad: Array<Record<string, unknown>> = [
        { date: '2026-02-30' },
        { date: '03/11/2026' },
        { date: '2026-11-03T10:00:00Z' },
        { date: '' },
        { id: 'not-a-uuid' },
        { score: -1 },
        { note: 'x'.repeat(5001) },
      ];
      for (const change of bad) {
        const res = await call('POST', `${T()}/logs`, await asA(), logBody(change));
        expect(res.statusCode, JSON.stringify(change)).toBe(400);
      }
      const noDate = { id: LOG1, hours: 1 };
      expect((await call('POST', `${T()}/logs`, await asA(), noDate)).statusCode).toBe(400);
      expect(await rows('select 1 from rnd.logs')).toHaveLength(0);
    });

    it('rolls everything back when an event cannot be written (no log, no hours, no event)', async () => {
      await testDb.admin(async (c) => {
        await c.query(
          `create function rnd.fail_logged() returns trigger language plpgsql as
           $$ begin if new.type = 'task.logged' then raise exception 'boom'; end if; return new; end $$`,
        );
        await c.query(
          `create trigger fail_logged before insert on rnd.events
           for each row execute function rnd.fail_logged()`,
        );
      });
      try {
        const res = await call('POST', `${T()}/logs`, await asA(), logBody());
        expect(res.statusCode).toBe(500);
        expect(errorResponseSchema.parse(res.json()).error.code).toBe('internal_error');
        expect(await rows('select 1 from rnd.logs')).toHaveLength(0);
        expect(await taskRow()).toMatchObject({ status: 'pending', done_hours: 0 });
        expect(await rows('select 1 from rnd.events')).toHaveLength(0);
      } finally {
        await testDb.admin(async (c) => {
          await c.query('drop trigger if exists fail_logged on rnd.events');
          await c.query('drop function if exists rnd.fail_logged()');
        });
      }
    });

    it('answers 404 for an unknown task', async () => {
      const res = await call('POST', `${T('ghost')}/logs`, await asA(), logBody());
      expect(res.statusCode).toBe(404);
    });
  });

  describe('complete, reopen and skip (explicit user actions)', () => {
    it('complete sets done, keeps done_hours, writes task.completed once (idempotent)', async () => {
      await call('POST', `${T()}/logs`, await asA(), logBody());
      const first = await call('POST', `${T()}/complete`, await asA());
      const again = await call('POST', `${T()}/complete`, await asA());
      expect(first.statusCode).toBe(200);
      expect(again.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ status: 'done', doneHours: 1.5 });
      expect(again.json()).toMatchObject({ status: 'done', doneHours: 1.5 });
      expect(await eventTypes()).toEqual(['task.completed', 'task.logged', 'task.started']);
    });

    it('complete works without any log (user says it is done)', async () => {
      const res = await call('POST', `${T('t4')}/complete`, await asA());
      expect(res.json()).toMatchObject({ status: 'done', doneHours: 0 });
    });

    it('a certificate task also writes certificate.earned, only once even after reopen', async () => {
      await call('POST', `${T('t3')}/complete`, await asA());
      expect(await eventTypes()).toEqual(['certificate.earned', 'task.completed']);
      const [cert] = await rows(`select payload from rnd.events where type = 'certificate.earned'`);
      expect(cert!.payload).toMatchObject({ taskId: 't3', certificateName: 'Cert X' });
      await call('POST', `${T('t3')}/reopen`, await asA());
      await call('POST', `${T('t3')}/complete`, await asA());
      const types = await eventTypes();
      expect(types.filter((t) => t === 'certificate.earned')).toHaveLength(1);
    });

    it('reopen returns to in_progress with logged hours, to pending without', async () => {
      await call('POST', `${T()}/logs`, await asA(), logBody());
      await call('POST', `${T()}/complete`, await asA());
      const withHours = await call('POST', `${T()}/reopen`, await asA());
      expect(withHours.json()).toMatchObject({ status: 'in_progress', doneHours: 1.5 });
      await call('POST', `${T('t4')}/complete`, await asA());
      const without = await call('POST', `${T('t4')}/reopen`, await asA());
      expect(without.json()).toMatchObject({ status: 'pending' });
      const noop = await call('POST', `${T('t4')}/reopen`, await asA());
      expect(noop.json()).toMatchObject({ status: 'pending' });
    });

    it('skip writes one task.skipped event, which a repeat does not duplicate', async () => {
      await call('POST', `${T('t4')}/skip`, await asA());
      await call('POST', `${T('t4')}/skip`, await asA());
      const events = await rows<{ payload: { taskId: string } }>(
        `select payload from rnd.events where type = 'task.skipped'`,
      );
      expect(events).toHaveLength(1);
      expect(events[0]!.payload.taskId).toBe('t4');
    });

    it('skip sets skipped (idempotent); a done task must be reopened first', async () => {
      const first = await call('POST', `${T('t4')}/skip`, await asA());
      const again = await call('POST', `${T('t4')}/skip`, await asA());
      expect(first.json()).toMatchObject({ status: 'skipped' });
      expect(again.json()).toMatchObject({ status: 'skipped' });
      await call('POST', `${T()}/complete`, await asA());
      expect((await call('POST', `${T()}/skip`, await asA())).statusCode).toBe(409);
      expect((await taskRow()).status).toBe('done');
      const back = await call('POST', `${T('t4')}/reopen`, await asA());
      expect(back.json()).toMatchObject({ status: 'pending' });
    });

    it('answers 404 for unknown tasks', async () => {
      for (const action of ['complete', 'reopen', 'skip']) {
        expect((await call('POST', `${T('ghost')}/${action}`, await asA())).statusCode).toBe(404);
      }
    });
  });

  describe('progress', () => {
    it('aggregates hours, types, days, certificates and done counts', async () => {
      const await_asA = await asA();
      const log = (id: string, task: string, date: string, hours: number) =>
        call('POST', `${T(task)}/logs`, await_asA, logBody({ id, date, hours }));
      await log(LOG1, 't1', '2026-11-03', 1.5);
      await log(LOG2, 't1', '2026-11-04', 2);
      await log(LOG3, 't3', '2026-11-04', 1);
      await call('POST', `${T('t3')}/complete`, await_asA);
      await call('POST', `${T('t4')}/skip`, await_asA);

      const res = await call('GET', `/plans/${PLAN_A}/progress`, await_asA);
      expect(res.statusCode).toBe(200);
      const p = res.json() as Progress;
      // Planned excludes the skipped task: 3 + 2 + 1.
      expect(p.hours).toEqual({ planned: 6, done: 4.5 });
      expect(p.tasks).toEqual({ total: 4, done: 1, skipped: 1 });
      expect(p.certificatesEarned).toBe(1);
      expect(p.certificates).toEqual([{ taskId: 't3', name: 'Cert X' }]);
      const type = (t: string) => p.byType.find((x) => x.type === t);
      expect(type('course')).toEqual({
        type: 'course',
        plannedHours: 5,
        doneHours: 3.5,
        tasksTotal: 2,
        tasksDone: 0,
      });
      expect(type('cert_exam')).toMatchObject({ plannedHours: 1, doneHours: 1, tasksDone: 1 });
      expect(type('practice')).toMatchObject({ plannedHours: 0, doneHours: 0, tasksTotal: 1 });
      expect(p.byDay).toEqual([
        { date: '2026-11-03', hours: 1.5, entries: 1 },
        { date: '2026-11-04', hours: 3, entries: 2 },
      ]);
    });

    it('is empty and zero for a plan without logs, and ignores other plans and users', async () => {
      await call('POST', `/plans/${PLAN_B}/tasks/t1/logs`, await asB(), logBody());
      await call('POST', `/plans/${PLAN_A2}/tasks/other/logs`, await asA(), logBody({ id: LOG2 }));
      const res = await call('GET', `/plans/${PLAN_A}/progress`, await asA());
      const p = res.json() as Progress;
      expect(p.hours).toEqual({ planned: 8, done: 0 });
      expect(p.byDay).toEqual([]);
      expect(p.certificatesEarned).toBe(0);
    });
  });

  describe('GET logs', () => {
    it('lists logs of the plan, filtered by from and to (inclusive), in date order', async () => {
      const h = await asA();
      await call('POST', `${T()}/logs`, h, logBody({ id: LOG1, date: '2026-11-05' }));
      await call('POST', `${T('t2')}/logs`, h, logBody({ id: LOG2, date: '2026-11-03' }));
      await call('POST', `${T('t4')}/logs`, h, logBody({ id: LOG3, date: '2026-11-10' }));
      await call(
        'POST',
        `/plans/${PLAN_A2}/tasks/other/logs`,
        h,
        logBody({ id: 'c0000000-0000-4000-8000-000000000009' }),
      );

      const all = await call('GET', `/plans/${PLAN_A}/logs`, h);
      const ids = (all.json() as { logs: Array<{ id: string }> }).logs.map((l) => l.id);
      expect(ids).toEqual([LOG2, LOG1, LOG3]);

      const ranged = await call('GET', `/plans/${PLAN_A}/logs?from=2026-11-05&to=2026-11-10`, h);
      expect((ranged.json() as { logs: Array<{ id: string }> }).logs.map((l) => l.id)).toEqual([
        LOG1,
        LOG3,
      ]);
      const only = await call('GET', `/plans/${PLAN_A}/logs?to=2026-11-03`, h);
      expect((only.json() as { logs: unknown[] }).logs).toHaveLength(1);
    });

    it('rejects bad dates and an inverted range', async () => {
      const h = await asA();
      for (const q of ['from=2026-13-01', 'to=nope', 'from=2026-11-10&to=2026-11-01']) {
        expect((await call('GET', `/plans/${PLAN_A}/logs?${q}`, h)).statusCode, q).toBe(400);
      }
    });
  });

  describe('OpenAPI', () => {
    it('documents every endpoint', async () => {
      const spec = (await app.inject({ method: 'GET', url: '/api/v1/openapi.json' })).json() as {
        paths: Record<string, Record<string, unknown>>;
      };
      const p = '/api/v1/plans/{planId}';
      expect(Object.keys(spec.paths[`${p}/tasks`]!)).toEqual(['get']);
      expect(Object.keys(spec.paths[`${p}/tasks/{taskId}`]!).sort()).toEqual(['get', 'patch']);
      for (const path of ['logs', 'progress', 'tasks/{taskId}/logs', 'tasks/{taskId}/complete']) {
        expect(spec.paths[`${p}/${path}`], path).toBeDefined();
      }
      expect(spec.paths[`${p}/tasks/{taskId}/reopen`]).toBeDefined();
      expect(spec.paths[`${p}/tasks/{taskId}/skip`]).toBeDefined();
    });
  });
});
