import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createDatabase, type Database } from '../src/db/database';
import { createSupabaseVerifier } from '../src/modules/accounts/token-verifier';
import { acceptCurrentLegal, dbAvailable, prepareDatabase, type TestDb } from './db-helpers';
import { testConfig } from './helpers';
import { ISSUER, makeTestKeys, type TestKeys } from './tokens';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PLAN_A = 'a0000000-0000-4000-8000-000000000001';
const PLAN_DST = 'a0000000-0000-4000-8000-000000000002';
const PLAN_B = 'b0000000-0000-4000-8000-000000000001';
const LOG = (n: number) => `c0000000-0000-4000-8000-00000000000${n}`;

type Method = 'GET' | 'PATCH' | 'POST' | 'PUT';
interface Block {
  taskId: string;
  date: string;
  start: string;
  end: string;
  minutes: number;
}

// Plan A starts on Sunday 2026-11-01 and studies Sunday to Thursday, 2 h a day, in Jerusalem
// (UTC+2 in November, after daylight saving ended on 2026-10-25).
const SUN = '2026-11-01';
const MON = '2026-11-02';
const TUE = '2026-11-03';
const WED = '2026-11-04';
const THU = '2026-11-05';
/** 10:00 local on the given Jerusalem date in November (UTC+2). */
const at = (date: string, time = '08:00') => new Date(`${date}T${time}:00Z`);

describe.skipIf(!dbAvailable)('day state: start, end, rollover (real Postgres)', () => {
  let testDb: TestDb;
  let db: Database;
  let keys: TestKeys;
  let app: ReturnType<typeof buildApp>;
  let clock = at(SUN);

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

  beforeEach(async () => {
    clock = at(SUN);
    await testDb.admin(async (c) => {
      await c.query('delete from rnd.app_users');
      await c.query('delete from rnd.allowed_emails');
      await c.query(
        `insert into rnd.allowed_emails (email) values ('a@example.com'), ('b@example.com')`,
      );
      await c.query(
        `insert into rnd.app_users (id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')`,
        [A, B],
      );
      await acceptCurrentLegal(c, [A, B]);
      const plan = async (user: string, id: string, start: string, created: string) => {
        await c.query(
          `insert into rnd.plans (user_id, id, created_from, name, status, start_date, created_at)
           values ($1, $2, 'builder', 'Plan', 'active', $3, $4)`,
          [user, id, start, created],
        );
        await c.query(
          `insert into rnd.week_patterns (user_id, plan_id, study_weekdays, default_hours,
             window_start, window_end, timezone)
           values ($1, $2, '{0,1,2,3,4}', 2, '09:00', '17:00', 'Asia/Jerusalem')`,
          [user, id],
        );
      };
      const task = (user: string, planId: string, id: string, order: number, est: number) =>
        c.query(
          `insert into rnd.tasks (user_id, plan_id, id, title, type, est_hours, sort_order)
           values ($1, $2, $3, $4, 'course', $5, $6)`,
          [user, planId, id, `Task ${id}`, est, order],
        );
      await plan(A, PLAN_A, SUN, '2026-10-30T10:00:00Z');
      await plan(A, PLAN_DST, '2026-10-18', '2026-10-01T10:00:00Z');
      await plan(B, PLAN_B, SUN, '2026-10-30T10:00:00Z');
      await task(A, PLAN_A, 't1', 0, 2);
      await task(A, PLAN_A, 't2', 1, 4);
      await task(A, PLAN_A, 't3', 2, 2);
      await task(A, PLAN_DST, 't1', 0, 80);
      await task(B, PLAN_B, 't1', 0, 6);
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
  const rows = <R = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    testDb.admin(async (c) => (await c.query(sql, params)).rows as R[]);
  const eventCount = async (type: string) =>
    (
      await rows<{ n: number }>(`select count(*)::int as n from rnd.events where type = $1`, [type])
    )[0]!.n;
  const snapshotDates = async (plan = PLAN_A) =>
    (
      await rows<{ date: string }>(
        `select date::text as date from rnd.schedule_days where plan_id = $1 order by date`,
        [plan],
      )
    ).map((r) => r.date);

  const DAY = (date: string, plan = PLAN_A) => `/plans/${plan}/days/${date}`;
  const schedule = async (plan = PLAN_A, query = '') => {
    const res = await call('GET', `/plans/${plan}/schedule${query}`, await asA());
    expect(res.statusCode).toBe(200);
    return res.json() as { today: string; blocks: Block[] };
  };
  const blocksOn = (blocks: Block[], date: string) => blocks.filter((b) => b.date === date);
  const logWork = async (n: number, task: string, date: string, hours: number) => {
    const res = await call('POST', `/plans/${PLAN_A}/tasks/${task}/logs`, await asA(), {
      id: LOG(n),
      date,
      hours,
    });
    expect(res.statusCode).toBeLessThan(300);
  };

  describe('authentication and isolation', () => {
    it.each<[Method, string]>([
      ['POST', DAY(SUN) + '/start'],
      ['POST', DAY(SUN) + '/end'],
      ['GET', DAY(SUN)],
      ['GET', `/plans/${PLAN_A}/open-tasks`],
    ])('%s %s without a token answers 401', async (method, url) => {
      expect((await call(method, url, {})).statusCode).toBe(401);
    });

    it('answers 404, identical to a missing plan, when another user reads, starts or ends a day', async () => {
      clock = at(TUE);
      const missing = await call(
        'GET',
        DAY(MON, 'f0000000-0000-4000-8000-000000000009'),
        await asB(),
      );
      expect(missing.statusCode).toBe(404);
      for (const [method, url] of [
        ['GET', DAY(MON)],
        ['POST', DAY(MON) + '/start'],
        ['POST', DAY(MON) + '/end'],
        ['GET', `/plans/${PLAN_A}/open-tasks`],
      ] as const) {
        const res = await call(method, url, await asB());
        expect(res.statusCode, `${method} ${url}`).toBe(404);
        expect(res.json().error.code).toBe('not_found');
        expect(res.json().error.message).toBe(missing.json().error.message);
      }
      // Nothing was written for A's plan by B's requests.
      expect(await snapshotDates()).toEqual([]);
      expect(await rows('select 1 from rnd.day_sessions')).toEqual([]);
      expect(await eventCount('day.started')).toBe(0);
    });

    it('never reads a user_id from the request', async () => {
      const res = await call('POST', DAY(SUN) + '/start?user_id=' + B, await asA(), {
        user_id: B,
        userId: B,
      });
      expect(res.statusCode).toBe(201);
      const end = await call('POST', DAY(SUN) + '/end?user_id=' + B, await asA(), { user_id: B });
      expect(end.statusCode).toBe(200);
      const owners = await rows<{ user_id: string }>(
        `select user_id from rnd.day_sessions union all select user_id from rnd.schedule_days
         union all select user_id from rnd.events where type like 'day.%'`,
      );
      expect(owners.length).toBeGreaterThanOrEqual(3);
      expect(new Set(owners.map((o) => o.user_id))).toEqual(new Set([A]));
    });
  });

  describe('starting a day', () => {
    it('starts today once: 201, then 200 with the same state and a single event', async () => {
      const first = await call('POST', DAY(SUN) + '/start', await asA());
      expect(first.statusCode).toBe(201);
      expect(first.json()).toMatchObject({
        date: SUN,
        status: 'started',
        endedAt: null,
        frozen: null,
      });
      clock = at(SUN, '09:00');
      const retry = await call('POST', DAY(SUN) + '/start', await asA());
      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toEqual(first.json());
      expect(await eventCount('day.started')).toBe(1);
      expect(await rows('select 1 from rnd.day_sessions')).toHaveLength(1);
    });

    it('refuses a future day with 422 and writes nothing', async () => {
      const res = await call('POST', DAY(MON) + '/start', await asA());
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('unprocessable');
      expect(await rows('select 1 from rnd.day_sessions')).toEqual([]);
    });

    it('refuses a date before the plan began', async () => {
      const res = await call('POST', DAY('2026-10-25') + '/start', await asA());
      expect(res.statusCode).toBe(422);
    });

    it('allows a past, unstarted day of the plan', async () => {
      clock = at(TUE);
      const res = await call('POST', DAY(MON) + '/start', await asA());
      expect(res.statusCode).toBe(201);
    });

    it('rejects a malformed date with the shared error shape', async () => {
      const res = await call('POST', `/plans/${PLAN_A}/days/2026-13-45/start`, await asA());
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('validation_error');
    });

    it('answers 422 for a plan without a week pattern', async () => {
      await rows('delete from rnd.week_patterns where plan_id = $1', [PLAN_A]);
      const res = await call('POST', DAY(SUN) + '/start', await asA());
      expect(res.statusCode).toBe(422);
    });
  });

  describe('ending a day', () => {
    it('freezes the day as it was planned, marks it ended and writes one event', async () => {
      const before = await schedule();
      const planned = blocksOn(before.blocks, SUN);
      expect(planned.length).toBeGreaterThan(0);

      const res = await call('POST', DAY(SUN) + '/end', await asA());
      expect(res.statusCode).toBe(200);
      const day = res.json();
      expect(day.status).toBe('ended');
      expect(day.frozen.source).toBe('day_end');
      expect(day.frozen.blocks).toEqual(planned);
      expect(await snapshotDates()).toEqual([SUN]);
      expect(await eventCount('day.ended')).toBe(1);
    });

    it('is idempotent: a retry returns the same state, one snapshot and one event', async () => {
      const first = (await call('POST', DAY(SUN) + '/end', await asA())).json();
      clock = at(SUN, '12:00');
      const retry = await call('POST', DAY(SUN) + '/end', await asA());
      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toEqual(first);
      expect(await snapshotDates()).toEqual([SUN]);
      expect(await eventCount('day.ended')).toBe(1);
    });

    it('keeps one snapshot and one event when several End requests arrive together', async () => {
      const headers = await asA();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => call('POST', DAY(SUN) + '/end', headers)),
      );
      expect(results.map((r) => r.statusCode)).toEqual(Array(6).fill(200));
      expect(new Set(results.map((r) => r.body)).size).toBe(1);
      expect(await snapshotDates()).toEqual([SUN]);
      expect(await eventCount('day.ended')).toBe(1);
    });

    it('refuses to end a future day with 422', async () => {
      const res = await call('POST', DAY(MON) + '/end', await asA());
      expect(res.statusCode).toBe(422);
      expect(await snapshotDates()).toEqual([]);
      expect(await eventCount('day.ended')).toBe(0);
    });

    it('ends a day that was never started', async () => {
      const res = await call('POST', DAY(SUN) + '/end', await asA());
      expect(res.json()).toMatchObject({ status: 'ended' });
      expect(res.json().startedAt).not.toBeNull();
    });

    it('plans the day as it stood at its start: work logged that day does not shrink it', async () => {
      // t1 (2 h) fills Sunday. Log all of it and finish the task, then end the day.
      const planned = blocksOn((await schedule()).blocks, SUN);
      await logWork(1, 't1', SUN, 2);
      expect(
        (await call('POST', `/plans/${PLAN_A}/tasks/t1/complete`, await asA())).statusCode,
      ).toBe(200);
      const res = await call('POST', DAY(SUN) + '/end', await asA());
      expect(res.json().frozen.blocks).toEqual(planned);
    });

    it('lets the user end a past day that was frozen automatically, without replacing the snapshot', async () => {
      clock = at(TUE);
      const auto = (await call('GET', DAY(MON), await asA())).json();
      expect(auto.frozen.source).toBe('auto_rollover');
      expect(auto.status).toBe('not_started');
      const ended = (await call('POST', DAY(MON) + '/end', await asA())).json();
      expect(ended.status).toBe('ended');
      expect(ended.frozen).toEqual(auto.frozen);
      expect(await eventCount('day.ended')).toBe(1);
      expect(await eventCount('day.rolled_over')).toBe(2);
    });
  });

  describe('automatic rollover', () => {
    it('freezes each missed day once, even when many reads arrive together', async () => {
      clock = at(THU);
      const headers = await asA();
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          call('GET', i % 2 ? `/plans/${PLAN_A}/schedule` : `/plans/${PLAN_A}/open-tasks`, headers),
        ),
      );
      expect(results.map((r) => r.statusCode)).toEqual(Array(8).fill(200));
      // Sunday to Wednesday have passed; Thursday is today.
      expect(await snapshotDates()).toEqual([SUN, MON, TUE, WED]);
      expect(await eventCount('day.rolled_over')).toBe(4);
      const sources = await rows<{ source: string }>(
        `select distinct source from rnd.schedule_days`,
      );
      expect(sources).toEqual([{ source: 'auto_rollover' }]);
    });

    it('also happens when the progress dashboard is read', async () => {
      clock = at(TUE);
      expect((await call('GET', `/plans/${PLAN_A}/progress`, await asA())).statusCode).toBe(200);
      expect(await snapshotDates()).toEqual([SUN, MON]);
    });

    it('does nothing on the first day of the plan, and a second read adds nothing', async () => {
      await schedule();
      expect(await snapshotDates()).toEqual([]);
      clock = at(MON);
      await schedule();
      await schedule();
      expect(await snapshotDates()).toEqual([SUN]);
      expect(await eventCount('day.rolled_over')).toBe(1);
    });

    it('does not replay days before the plan was created', async () => {
      // Created on 2026-10-30 with a start date long ago: only days from creation on exist.
      await rows(`update rnd.plans set start_date = '2026-01-04' where id = $1`, [PLAN_A]);
      clock = at(MON);
      await schedule();
      expect(await snapshotDates()).toEqual(['2026-10-30', '2026-10-31', SUN]);
    });

    it('ignores a client-supplied today when deciding what to freeze', async () => {
      await schedule(PLAN_A, '?today=2027-06-01');
      expect(await snapshotDates()).toEqual([]);
    });

    it('returns the frozen blocks of a past day and no blocks for today', async () => {
      clock = at(TUE);
      const mon = (await call('GET', DAY(MON), await asA())).json();
      expect(mon.frozen.blocks.length).toBeGreaterThan(0);
      expect(mon.frozen.blocks.every((b: Block) => b.date === MON)).toBe(true);
      const tue = (await call('GET', DAY(TUE), await asA())).json();
      expect(tue).toMatchObject({ status: 'not_started', frozen: null });
    });
  });

  describe('past days never change', () => {
    it('keeps an ended day byte-identical after estimates, the week pattern and overrides change', async () => {
      const original = blocksOn((await schedule()).blocks, SUN);
      await call('POST', DAY(SUN) + '/end', await asA());
      clock = at(MON);

      const patched = await call('PATCH', `/plans/${PLAN_A}/tasks/t1`, await asA(), {
        estHours: 9,
      });
      expect(patched.statusCode).toBe(200);
      const pattern = await call('PUT', `/plans/${PLAN_A}/week-pattern`, await asA(), {
        studyWeekdays: [0, 1, 2, 3, 4, 5],
        defaultHours: 5,
        windowStart: '08:00',
        windowEnd: '20:00',
        timezone: 'Asia/Jerusalem',
      });
      expect(pattern.statusCode).toBe(200);
      const override = await call('PUT', `/plans/${PLAN_A}/day-overrides/${SUN}`, await asA(), {
        isStudyDay: false,
      });
      expect(override.statusCode).toBe(200);

      const after = await schedule();
      expect(JSON.stringify(blocksOn(after.blocks, SUN))).toBe(JSON.stringify(original));
      // Later days did move, so the test is not trivially true.
      expect(blocksOn(after.blocks, MON).length).toBeGreaterThan(0);
      const stored = (await call('GET', DAY(SUN), await asA())).json();
      expect(JSON.stringify(stored.frozen.blocks)).toBe(JSON.stringify(original));
    });

    it('keeps an automatically frozen day unchanged after later edits', async () => {
      clock = at(MON);
      const frozen = blocksOn((await schedule()).blocks, SUN);
      expect(frozen.length).toBeGreaterThan(0);
      await call('PATCH', `/plans/${PLAN_A}/tasks/t2`, await asA(), { estHours: 1 });
      await call('PUT', `/plans/${PLAN_A}/week-pattern`, await asA(), {
        studyWeekdays: [0, 1],
        defaultHours: 8,
        windowStart: '07:00',
        windowEnd: '21:00',
        timezone: 'Asia/Jerusalem',
      });
      const preview = await call('POST', `/plans/${PLAN_A}/schedule/preview`, await asA(), {
        overrides: [{ date: TUE, isStudyDay: false }],
      });
      expect(preview.statusCode).toBe(200);
      expect(blocksOn(preview.json().proposed.blocks, SUN)).toEqual(frozen);
      expect(blocksOn((await schedule()).blocks, SUN)).toEqual(frozen);
    });

    it('schedules from tomorrow once today has been ended', async () => {
      const before = await schedule();
      const sunday = blocksOn(before.blocks, SUN);
      await call('POST', DAY(SUN) + '/end', await asA());
      const after = await schedule();
      expect(blocksOn(after.blocks, SUN)).toEqual(sunday);
      expect(after.today).toBe(SUN);
    });
  });

  describe('carried-over tasks', () => {
    it('marks open tasks planned on earlier frozen days and leaves finished ones out', async () => {
      // Sunday: t1 (2 h). Monday: t2 (2 h of 4). Tuesday: the rest of t2. Wednesday: t3.
      await logWork(1, 't1', SUN, 2);
      await call('POST', `/plans/${PLAN_A}/tasks/t1/complete`, await asA());
      await logWork(2, 't2', MON, 1);
      clock = at(TUE);
      const res = await call('GET', `/plans/${PLAN_A}/open-tasks`, await asA());
      expect(res.statusCode).toBe(200);
      const view = res.json();
      expect(view).toMatchObject({ today: TUE, weekStart: SUN, weekEnd: '2026-11-07' });
      const byId = new Map(view.tasks.map((t: { taskId: string }) => [t.taskId, t]));
      expect(byId.has('t1')).toBe(false);
      expect(byId.get('t2')).toMatchObject({
        status: 'in_progress',
        carriedOverFrom: [MON],
        remainingHours: 3,
      });
      expect(byId.get('t3')).toMatchObject({ carriedOverFrom: [] });
      expect((byId.get('t3') as { plannedDates: string[] }).plannedDates.length).toBeGreaterThan(0);
      // Monday's snapshot is what was planned when the day began: all of t2's 2 h.
      const mon = (await call('GET', DAY(MON), await asA())).json();
      const t2 = mon.frozen.blocks.filter((b: Block) => b.taskId === 't2');
      expect(t2.reduce((sum: number, b: Block) => sum + b.minutes, 0)).toBe(120);
    });

    it('lists a task once, with every earlier day it was planned on and not done', async () => {
      clock = at(WED);
      const view = (await call('GET', `/plans/${PLAN_A}/open-tasks`, await asA())).json();
      // Nothing was logged, so t1 (2 h) was the plan on every day so far.
      const t1 = view.tasks.find((t: { taskId: string }) => t.taskId === 't1');
      expect(t1.carriedOverFrom).toEqual([SUN, MON, TUE]);
      expect(view.tasks.filter((t: { taskId: string }) => t.taskId === 't1')).toHaveLength(1);
    });

    it('lists a task skipped yesterday as skipped and carried over, so it can be reconsidered', async () => {
      await logWork(1, 't1', SUN, 2);
      await call('POST', `/plans/${PLAN_A}/tasks/t1/complete`, await asA());
      // Sunday t1, Monday t2 (the plan for Monday), skipped during Monday.
      clock = at(MON);
      await call('POST', `/plans/${PLAN_A}/tasks/t2/skip`, await asA());
      clock = at(TUE);
      const view = (await call('GET', `/plans/${PLAN_A}/open-tasks`, await asA())).json();
      const t2 = view.tasks.find((t: { taskId: string }) => t.taskId === 't2');
      expect(t2).toMatchObject({
        status: 'skipped',
        carriedOverFrom: [MON],
        plannedDates: [MON], // Monday's frozen block is part of this week
        remainingHours: 4,
      });
      expect(view.tasks.filter((t: { taskId: string }) => t.taskId === 't2')).toHaveLength(1);
    });

    it('leaves out a skipped task that was never planned on an earlier day, and done tasks', async () => {
      // t3 is only planned from Wednesday on, so skipping it on Tuesday carries nothing over.
      clock = at(TUE);
      await call('POST', `/plans/${PLAN_A}/tasks/t3/skip`, await asA());
      clock = at(WED);
      await call('POST', `/plans/${PLAN_A}/tasks/t1/complete`, await asA());
      const view = (await call('GET', `/plans/${PLAN_A}/open-tasks`, await asA())).json();
      const ids = view.tasks.map((t: { taskId: string }) => t.taskId);
      expect(ids).not.toContain('t3');
      expect(ids).not.toContain('t1');
    });

    it('lists the task again as open once it is reopened', async () => {
      await logWork(1, 't1', SUN, 2);
      await call('POST', `/plans/${PLAN_A}/tasks/t1/complete`, await asA());
      clock = at(MON);
      await call('POST', `/plans/${PLAN_A}/tasks/t2/skip`, await asA());
      clock = at(TUE);
      await call('POST', `/plans/${PLAN_A}/tasks/t2/reopen`, await asA());
      const view = (await call('GET', `/plans/${PLAN_A}/open-tasks`, await asA())).json();
      const t2 = view.tasks.find((t: { taskId: string }) => t.taskId === 't2');
      expect(t2).toMatchObject({ status: 'pending', carriedOverFrom: [MON] });
    });
  });

  describe('a day snapshot is the plan as of the start of that day', () => {
    /** Sunday's work is done, so Monday's plan is t2 (2 h of its 4). */
    const finishSunday = async () => {
      clock = at(SUN);
      await logWork(1, 't1', SUN, 2);
      await call('POST', `/plans/${PLAN_A}/tasks/t1/complete`, await asA());
    };

    const minutesOf = (blocks: Block[], task: string) =>
      blocks.filter((b) => b.taskId === task).reduce((sum, b) => sum + b.minutes, 0);

    it('keeps a task skipped during the day in that day’s snapshot', async () => {
      await finishSunday();
      clock = at(MON);
      await call('POST', `/plans/${PLAN_A}/tasks/t2/skip`, await asA());
      clock = at(TUE);
      const mon = (await call('GET', DAY(MON), await asA())).json();
      expect(minutesOf(mon.frozen.blocks, 't2')).toBe(120);
    });

    it('keeps a task marked done during the day, with no log, in that day’s snapshot', async () => {
      await finishSunday();
      clock = at(MON);
      await call('POST', `/plans/${PLAN_A}/tasks/t2/complete`, await asA());
      clock = at(TUE);
      const mon = (await call('GET', DAY(MON), await asA())).json();
      expect(minutesOf(mon.frozen.blocks, 't2')).toBe(120);
      // Done tasks stay out of the open list.
      const view = (await call('GET', `/plans/${PLAN_A}/open-tasks`, await asA())).json();
      expect(view.tasks.map((t: { taskId: string }) => t.taskId)).not.toContain('t2');
    });

    it('does not put a task skipped on an earlier day into a later day’s snapshot', async () => {
      await finishSunday();
      clock = at(MON);
      await call('POST', `/plans/${PLAN_A}/tasks/t2/skip`, await asA());
      clock = at(WED);
      const tue = (await call('GET', DAY(TUE), await asA())).json();
      expect(minutesOf(tue.frozen.blocks, 't2')).toBe(0);
    });

    it('freezes the same blocks when the day is ended by hand after the task was skipped', async () => {
      await finishSunday();
      clock = at(MON);
      await call('POST', `/plans/${PLAN_A}/tasks/t2/skip`, await asA());
      const ended = (await call('POST', DAY(MON) + '/end', await asA())).json();
      expect(minutesOf(ended.frozen.blocks, 't2')).toBe(120);
    });
  });

  describe('time zones and daylight saving', () => {
    it.each([
      // Autumn change: clocks go back at 02:00 local on 2026-10-25 (Asia/Jerusalem).
      ['2026-10-24T21:30:00Z', '2026-10-25'], // 00:30 IDT, UTC date is still the 24th
      ['2026-10-25T21:30:00Z', '2026-10-25'], // 23:30 IST, the 25-hour day is not over yet
      ['2026-10-25T22:00:00Z', '2026-10-26'], // 00:00 IST
      // Spring change: clocks go forward at 02:00 local on 2026-03-27.
      ['2026-03-26T21:59:00Z', '2026-03-26'], // 23:59 IST
      ['2026-03-26T22:00:00Z', '2026-03-27'], // 00:00 IST, the 23-hour day begins
      ['2026-03-27T20:59:00Z', '2026-03-27'], // 23:59 IDT
      ['2026-03-27T21:00:00Z', '2026-03-28'], // 00:00 IDT
    ])('reads the plan-local date at %s as %s', async (instant, local) => {
      if (instant.startsWith('2026-03')) {
        await rows(
          `update rnd.plans set start_date = '2026-03-01', created_at = '2026-03-01T10:00:00Z'
           where id = $1`,
          [PLAN_DST],
        );
      }
      clock = new Date(instant);
      const res = await call('GET', `/plans/${PLAN_DST}/schedule`, await asA());
      expect(res.json().today).toBe(local);
      // Today may be started; tomorrow may not.
      expect((await call('POST', DAY(local, PLAN_DST) + '/start', await asA())).statusCode).toBe(
        201,
      );
      const next = new Date(`${local}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      const tomorrow = next.toISOString().slice(0, 10);
      expect((await call('POST', DAY(tomorrow, PLAN_DST) + '/start', await asA())).statusCode).toBe(
        422,
      );
    });

    it('freezes the 25-hour day exactly once and moves on at local midnight', async () => {
      clock = new Date('2026-10-25T21:30:00Z'); // 23:30 on the long day
      await call('GET', `/plans/${PLAN_DST}/schedule`, await asA());
      expect(await snapshotDates(PLAN_DST)).not.toContain('2026-10-25');
      clock = new Date('2026-10-25T22:00:00Z'); // 00:00 the next day
      await call('GET', `/plans/${PLAN_DST}/schedule`, await asA());
      const dates = await snapshotDates(PLAN_DST);
      expect(dates).toContain('2026-10-25');
      expect(dates).not.toContain('2026-10-26');
      expect(new Set(dates).size).toBe(dates.length);
    });

    it('treats 23:30 local as still the same day, and ending it works', async () => {
      clock = new Date('2026-11-01T21:30:00Z'); // Sunday 23:30 in Jerusalem
      expect((await call('POST', DAY(MON) + '/end', await asA())).statusCode).toBe(422);
      expect((await call('POST', DAY(SUN) + '/end', await asA())).statusCode).toBe(200);
      clock = new Date('2026-11-01T22:00:00Z'); // Monday 00:00
      expect((await call('POST', DAY(MON) + '/end', await asA())).statusCode).toBe(200);
    });
  });
});
