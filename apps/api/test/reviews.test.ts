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
/** User A's plan whose first three course tasks are done and slower than estimated. */
const PLAN_DRIFT = 'a0000000-0000-4000-8000-000000000002';
/** Like PLAN_DRIFT, but one remaining task is an anchor that cannot get longer. */
const PLAN_ANCHOR = 'a0000000-0000-4000-8000-000000000003';
const PLAN_B = 'b0000000-0000-4000-8000-000000000001';
const LOG = (n: number) => `c0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

type Method = 'GET' | 'POST' | 'PUT';

// Plan A starts on Sunday 2026-11-01, studies Sunday to Thursday, 2 h a day, in Jerusalem
// (UTC+2 in November). Eight 2-hour course tasks: 16 h, finishing on Wednesday 2026-11-11 when
// work starts on the first Sunday.
const SUN = '2026-11-01';
const MON = '2026-11-02';
const TUE = '2026-11-03';
const WED = '2026-11-04';
const THU = '2026-11-05';
const FRI = '2026-11-06';
const at = (date: string, time = '08:00') => new Date(`${date}T${time}:00Z`);

interface Suggestion {
  id: string;
  rule: string;
  key: string;
  proposedChange: { kind: string };
  alternatives: { kind: string }[];
  evidence: { reviewDates: string[]; taskIds: string[] };
}

describe.skipIf(!dbAvailable)('day review and adjustment suggestions (real Postgres)', () => {
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

  const rows = <R = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    testDb.admin(async (c) => (await c.query(sql, params)).rows as R[]);

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
      const plan = async (user: string, id: string) => {
        await c.query(
          `insert into rnd.plans (user_id, id, created_from, name, status, start_date, created_at)
           values ($1, $2, 'builder', 'Plan', 'active', $3, '2026-10-30T10:00:00Z')`,
          [user, id, SUN],
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
        est: number,
        status = 'pending',
        done = 0,
      ) =>
        c.query(
          `insert into rnd.tasks (user_id, plan_id, id, title, type, est_hours, sort_order, status, done_hours)
           values ($1, $2, $3, $4, 'course', $5, $6, $7, $8)`,
          [user, planId, id, `Task ${id}`, est, order, status, done],
        );
      await plan(A, PLAN_A);
      await plan(A, PLAN_DRIFT);
      await plan(A, PLAN_ANCHOR);
      await plan(B, PLAN_B);
      for (let i = 1; i <= 8; i++) await task(A, PLAN_A, `c${i}`, i, 2);
      await task(B, PLAN_B, 'b-only', 1, 2);
      for (const p of [PLAN_DRIFT, PLAN_ANCHOR]) {
        for (let i = 1; i <= 3; i++) {
          await task(A, p, `d${i}`, i, 2, 'done', 3);
          await c.query(
            `insert into rnd.logs (user_id, id, plan_id, task_id, date, hours)
             values ($1, gen_random_uuid(), $2, $3, $4, 3)`,
            [A, p, `d${i}`, `2026-11-0${i}`],
          );
        }
        await task(A, p, 'd4', 4, 2);
      }
      await task(A, PLAN_DRIFT, 'd5', 5, 2);
      await c.query(
        `insert into rnd.tasks (user_id, plan_id, id, title, type, est_hours, sort_order,
           is_anchor, anchor_date, anchor_start_time)
         values ($1, $2, 'd5', 'Anchor', 'course', 1, 5, true, '2026-12-01', '22:30')`,
        [A, PLAN_ANCHOR],
      );
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

  const reviewUrl = (date: string, plan = PLAN_A) => `/plans/${plan}/days/${date}/review`;
  const body = (date: string, over: Record<string, unknown> = {}) => ({
    date,
    difficulty: 3,
    density: 3,
    energy: 3,
    note: '',
    outcomes: [],
    ...over,
  });
  const putReview = async (date: string, over: Record<string, unknown> = {}, plan = PLAN_A) =>
    call('PUT', reviewUrl(date, plan), await asA(), body(date, over));
  const suggestions = async (plan = PLAN_A) => {
    const res = await call('GET', `/plans/${plan}/suggestions`, await asA());
    expect(res.statusCode).toBe(200);
    return (res.json() as { suggestions: Suggestion[] }).suggestions;
  };
  const sug = (id: string, verb: string, plan = PLAN_A) =>
    `/plans/${plan}/suggestions/${id}/${verb}`;
  const eventCount = async (type: string) =>
    (
      await rows<{ n: number }>(`select count(*)::int as n from rnd.events where type = $1`, [type])
    )[0]!.n;
  const adjustmentRows = (plan = PLAN_A) =>
    rows<{ suggestion_id: string; status: string; rule: string }>(
      `select suggestion_id, status, rule from rnd.adjustments where plan_id = $1`,
      [plan],
    );
  const hoursByWeekday = async (plan = PLAN_A) =>
    (
      await rows<{ hours_by_weekday: Record<string, number> }>(
        `select hours_by_weekday from rnd.week_patterns where plan_id = $1`,
        [plan],
      )
    )[0]!.hours_by_weekday;
  const finishDate = async (plan = PLAN_A) => {
    const res = await call('GET', `/plans/${plan}/schedule`, await asA());
    return (res.json() as { finishDate: string | null }).finishDate;
  };

  /** Two "too much" days in a row on Sunday and Monday, ending with the clock on Monday. */
  const heavyDays = async () => {
    clock = at(SUN);
    expect((await putReview(SUN, { density: 5 })).statusCode).toBe(201);
    clock = at(MON);
    expect((await putReview(MON, { density: 5 })).statusCode).toBe(201);
    const open = await suggestions();
    const found = open.find((s) => s.rule === 'density_too_high');
    expect(found).toBeDefined();
    return found!;
  };

  describe('authentication and isolation', () => {
    const routes = (id: string): [Method, string, unknown?][] => [
      ['PUT', reviewUrl(MON), body(MON)],
      ['GET', reviewUrl(MON)],
      ['GET', `/plans/${PLAN_A}/reviews`],
      ['GET', `/plans/${PLAN_A}/suggestions`],
      ['POST', sug(id, 'preview')],
      ['POST', sug(id, 'accept'), { option: 0 }],
      ['POST', sug(id, 'reject'), {}],
    ];

    it('answers 401 on every route without a token', async () => {
      for (const [method, url, payload] of routes('sg_00000000000000')) {
        const res = await call(method, url, {}, payload);
        expect(res.statusCode, `${method} ${url}`).toBe(401);
      }
    });

    it('answers 404, identical to a missing plan, when another user calls any route, and writes nothing', async () => {
      clock = at(MON);
      const suggestion = await heavyDays();
      const adjustmentsBefore = await adjustmentRows();
      const reviewsBefore = await rows('select * from rnd.day_reviews order by date');
      const hoursBefore = await hoursByWeekday();
      const eventsBefore = await rows('select type from rnd.events order by created_at, id');
      const missing = await call(
        'GET',
        `/plans/f0000000-0000-4000-8000-000000000009/suggestions`,
        await asB(),
      );
      expect(missing.statusCode).toBe(404);
      for (const [method, url, payload] of routes(suggestion.id)) {
        const res = await call(method, url, await asB(), payload);
        expect(res.statusCode, `${method} ${url}`).toBe(404);
        expect(res.json().error.code).toBe('not_found');
        expect(res.json().error.message).toBe(missing.json().error.message);
      }
      expect(await adjustmentRows()).toEqual(adjustmentsBefore);
      expect(await rows('select * from rnd.day_reviews order by date')).toEqual(reviewsBefore);
      expect(await hoursByWeekday()).toEqual(hoursBefore);
      expect(await rows('select type from rnd.events order by created_at, id')).toEqual(
        eventsBefore,
      );
    });

    it('never reads a user_id or plan_id from the body, and never shows one user’s reviews to another', async () => {
      const res = await call(
        'PUT',
        reviewUrl(SUN) + '?user_id=' + B,
        await asA(),
        body(SUN, { user_id: B, userId: B, planId: PLAN_B, plan_id: PLAN_B }),
      );
      expect(res.statusCode).toBe(201);
      const stored = await rows<{ user_id: string; plan_id: string }>(
        'select user_id, plan_id from rnd.day_reviews',
      );
      expect(stored).toEqual([{ user_id: A, plan_id: PLAN_A }]);
      expect(
        await rows(`select 1 from rnd.events where user_id = $1 and type like 'review.%'`, [B]),
      ).toEqual([]);
      // B has the same date on B's own plan: separate review, not blocked by A's.
      const own = await call('PUT', reviewUrl(SUN, PLAN_B), await asB(), body(SUN));
      expect(own.statusCode).toBe(201);
      expect((await call('GET', reviewUrl(SUN, PLAN_B), await asA())).statusCode).toBe(404);
    });
  });

  describe('submitting a review', () => {
    it('stores it (201), returns it, and answers a retry with 200 and no second event', async () => {
      const first = await putReview(SUN, {
        difficulty: 4,
        density: 2,
        energy: 5,
        note: 'felt ok',
        outcomes: [{ taskId: 'c1', outcome: 'done' }],
      });
      expect(first.statusCode).toBe(201);
      expect(first.json()).toMatchObject({
        created: true,
        review: {
          date: SUN,
          difficulty: 4,
          density: 2,
          energy: 5,
          note: 'felt ok',
          outcomes: [{ taskId: 'c1', outcome: 'done' }],
        },
      });
      const retry = await putReview(SUN, {
        difficulty: 4,
        density: 2,
        energy: 5,
        note: 'felt ok',
        outcomes: [{ taskId: 'c1', outcome: 'done' }],
      });
      expect(retry.statusCode).toBe(200);
      expect(retry.json().created).toBe(false);
      expect(retry.json().review).toEqual(first.json().review);
      expect(await rows('select 1 from rnd.day_reviews')).toHaveLength(1);
      expect(await eventCount('review.submitted')).toBe(1);
      expect(await eventCount('review.updated')).toBe(0);
    });

    it('keeps the free-text note out of the event log', async () => {
      await putReview(SUN, { note: 'private words' });
      const events = await rows<{ payload: unknown }>(
        `select payload from rnd.events where type = 'review.submitted'`,
      );
      expect(JSON.stringify(events)).not.toContain('private words');
      expect(events[0]!.payload).toMatchObject({ date: SUN, difficulty: 3, outcomeCount: 0 });
    });

    it('validates the body: ratings 1-5, note length, one outcome per task, hours for partial', async () => {
      for (const bad of [
        { difficulty: 0 },
        { density: 6 },
        { energy: 2.5 },
        { note: 'x'.repeat(2001) },
        {
          outcomes: [
            { taskId: 'c1', outcome: 'done' },
            { taskId: 'c1', outcome: 'not_done' },
          ],
        },
        { outcomes: [{ taskId: 'c1', outcome: 'partial' }] },
        { outcomes: [{ taskId: 'c1', outcome: 'not_done', hours: 1 }] },
        { outcomes: [{ taskId: 'c1', outcome: 'done', reason: 'x'.repeat(501) }] },
      ]) {
        const res = await putReview(SUN, bad);
        expect(res.statusCode, JSON.stringify(bad)).toBe(400);
      }
      expect(await rows('select 1 from rnd.day_reviews')).toEqual([]);
    });

    it('refuses a NUL character in the note, an outcome reason or a task id with 422, not 500', async () => {
      for (const over of [
        { note: 'a\u0000b' },
        { outcomes: [{ taskId: 'c1', outcome: 'not_done', reason: 'x\u0000y' }] },
        { outcomes: [{ taskId: 'c\u00001', outcome: 'done' }] },
      ]) {
        const res = await putReview(SUN, over);
        expect(res.statusCode, JSON.stringify(over)).toBe(422);
      }
      expect(await rows('select 1 from rnd.day_reviews')).toEqual([]);
    });

    it('refuses a refused-NUL decision body with 422 too', async () => {
      const suggestion = await heavyDays();
      const res = await call('POST', sug(suggestion.id, 'reject'), await asA(), { 'a\u0000': 1 });
      expect([400, 422]).toContain(res.statusCode);
      expect(await adjustmentRows()).toEqual([]);
    });

    it('refuses a future date with 422 (plan-local, so just after midnight in Jerusalem counts)', async () => {
      expect((await putReview(MON)).statusCode).toBe(422);
      // 23:30 UTC on Sunday is already Monday 01:30 in Jerusalem.
      clock = new Date(`${SUN}T23:30:00Z`);
      expect((await putReview(MON)).statusCode).toBe(201);
      expect((await putReview(TUE)).statusCode).toBe(422);
      expect(await rows('select date::text as d from rnd.day_reviews')).toEqual([{ d: MON }]);
    });

    it('refuses a body date that differs from the URL date, and a date before the plan began', async () => {
      const res = await call('PUT', reviewUrl(SUN), await asA(), body(MON));
      expect(res.statusCode).toBe(422);
      clock = at(MON);
      expect((await putReview('2026-10-25')).statusCode).toBe(422);
    });

    it('accepts a non-study day only when work was logged or the day was started', async () => {
      clock = at(FRI);
      const refused = await putReview(FRI);
      expect(refused.statusCode).toBe(422);
      expect(refused.json().error.message).toMatch(/study day/);
      const log = await call('POST', `/plans/${PLAN_A}/tasks/c1/logs`, await asA(), {
        id: LOG(1),
        date: FRI,
        hours: 1,
      });
      expect(log.statusCode).toBe(201);
      expect((await putReview(FRI)).statusCode).toBe(201);
      // A started day counts as well.
      clock = at('2026-11-07');
      expect((await putReview('2026-11-07')).statusCode).toBe(422);
      expect(
        (await call('POST', `/plans/${PLAN_A}/days/2026-11-07/start`, await asA())).statusCode,
      ).toBe(201);
      expect((await putReview('2026-11-07')).statusCode).toBe(201);
    });

    it('refuses an outcome that names a task of another plan or user, and stores nothing', async () => {
      for (const taskId of ['b-only', 'nope']) {
        const res = await putReview(SUN, { outcomes: [{ taskId, outcome: 'done' }] });
        expect(res.statusCode, taskId).toBe(422);
      }
      expect(await rows('select 1 from rnd.day_reviews')).toEqual([]);
      expect(await eventCount('review.submitted')).toBe(0);
    });

    it('never logs hours or closes a task for a partial or done outcome, but says what is missing', async () => {
      const res = await putReview(SUN, {
        outcomes: [
          { taskId: 'c1', outcome: 'partial', hours: 1.5 },
          { taskId: 'c2', outcome: 'done' },
          { taskId: 'c3', outcome: 'not_done', reason: 'ran out of time' },
        ],
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().missingLogs).toEqual([
        { taskId: 'c1', reportedHours: 1.5, loggedHours: 0, missingHours: 1.5 },
      ]);
      expect(res.json().notMarkedDone).toEqual(['c2']);
      expect(await rows('select 1 from rnd.logs where plan_id = $1', [PLAN_A])).toEqual([]);
      const tasks = await rows<{ id: string; status: string; done_hours: string }>(
        `select id, status, done_hours from rnd.tasks where plan_id = $1 and id in ('c1','c2','c3')
         order by id`,
        [PLAN_A],
      );
      expect(tasks.map((t) => [t.status, Number(t.done_hours)])).toEqual([
        ['pending', 0],
        ['pending', 0],
        ['pending', 0],
      ]);

      // After the user logs part of it, the gap shrinks; once all is logged and done is set, empty.
      await call('POST', `/plans/${PLAN_A}/tasks/c1/logs`, await asA(), {
        id: LOG(2),
        date: SUN,
        hours: 1,
      });
      await call('POST', `/plans/${PLAN_A}/tasks/c2/complete`, await asA());
      const again = await putReview(SUN, {
        outcomes: [
          { taskId: 'c1', outcome: 'partial', hours: 1.5 },
          { taskId: 'c2', outcome: 'done' },
          { taskId: 'c3', outcome: 'not_done', reason: 'ran out of time' },
        ],
      });
      expect(again.statusCode).toBe(200);
      expect(again.json().missingLogs).toEqual([
        { taskId: 'c1', reportedHours: 1.5, loggedHours: 1, missingHours: 0.5 },
      ]);
      expect(again.json().notMarkedDone).toEqual([]);
    });

    it('can be re-saved on its day and the day after, and is then locked (409) unless nothing changes', async () => {
      expect((await putReview(SUN, { energy: 2 })).statusCode).toBe(201);
      const sameDay = await putReview(SUN, { energy: 4, note: 'changed' });
      expect(sameDay.statusCode).toBe(200);
      expect(sameDay.json()).toMatchObject({
        created: false,
        review: { energy: 4, note: 'changed' },
      });
      clock = at(MON);
      expect((await putReview(SUN, { energy: 5, note: 'changed' })).statusCode).toBe(200);
      clock = at(TUE);
      const late = await putReview(SUN, { energy: 1, note: 'changed' });
      expect(late.statusCode).toBe(409);
      expect(late.json().error.code).toBe('conflict');
      // The identical content is still answered (a retry never fails).
      expect((await putReview(SUN, { energy: 5, note: 'changed' })).statusCode).toBe(200);
      const [row] = await rows<{ energy: number; note: string }>(
        'select energy, note from rnd.day_reviews',
      );
      expect(row).toEqual({ energy: 5, note: 'changed' });
      expect(await rows('select 1 from rnd.day_reviews')).toHaveLength(1);
      expect(await eventCount('review.submitted')).toBe(1);
      expect(await eventCount('review.updated')).toBe(2);
    });

    it('lets a missed day be reviewed later (back-filling) once, as a new review', async () => {
      clock = at(WED);
      expect((await putReview(MON)).statusCode).toBe(201);
      expect((await putReview(MON, { note: 'x' })).statusCode).toBe(409);
    });
  });

  describe('reading reviews', () => {
    it('answers 404 for a day without a review and the review once it exists', async () => {
      expect((await call('GET', reviewUrl(SUN), await asA())).statusCode).toBe(404);
      await putReview(SUN, { note: 'hello', difficulty: 5 });
      const res = await call('GET', reviewUrl(SUN), await asA());
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ date: SUN, difficulty: 5, note: 'hello' });
    });

    it('lists the ratings per day, oldest first, filtered by from and to, without notes', async () => {
      await putReview(SUN, { difficulty: 1, density: 2, energy: 3, note: 'secret' });
      clock = at(MON);
      await putReview(MON, { difficulty: 4, density: 5, energy: 1 });
      clock = at(TUE);
      await putReview(TUE, { difficulty: 2, density: 3, energy: 4 });

      const all = await call('GET', `/plans/${PLAN_A}/reviews`, await asA());
      expect(all.statusCode).toBe(200);
      expect(all.json().reviews).toEqual([
        { date: SUN, difficulty: 1, density: 2, energy: 3 },
        { date: MON, difficulty: 4, density: 5, energy: 1 },
        { date: TUE, difficulty: 2, density: 3, energy: 4 },
      ]);
      expect(JSON.stringify(all.json())).not.toContain('secret');

      const some = await call('GET', `/plans/${PLAN_A}/reviews?from=${MON}&to=${MON}`, await asA());
      expect(some.json().reviews.map((r: { date: string }) => r.date)).toEqual([MON]);
      const bad = await call('GET', `/plans/${PLAN_A}/reviews?from=${TUE}&to=${SUN}`, await asA());
      expect(bad.statusCode).toBe(400);
    });
  });

  describe('the four rules through the API', () => {
    it('density too high two study days in a row: suggested with its evidence, nothing changes by itself', async () => {
      const before = await hoursByWeekday();
      const suggestion = await heavyDays();
      expect(suggestion.evidence.reviewDates).toEqual([SUN, MON]);
      expect(suggestion.proposedChange.kind).toBe('capacityDelta');
      expect(await hoursByWeekday()).toEqual(before);
      expect(await adjustmentRows()).toEqual([]);
      // The same suggestion comes back with the review response.
      const again = await putReview(MON, { density: 5 });
      expect(again.json().suggestions.map((s: Suggestion) => s.id)).toContain(suggestion.id);
    });

    it('density too low: offers more hours or pulling work forward, and the alternative can be accepted', async () => {
      expect((await putReview(SUN, { density: 1 })).statusCode).toBe(201);
      const [suggestion] = await suggestions();
      expect(suggestion!.rule).toBe('density_too_low');
      expect(suggestion!.proposedChange.kind).toBe('capacityDelta');
      expect(suggestion!.alternatives.map((a) => a.kind)).toEqual(['pullForward']);

      const accepted = await call('POST', sug(suggestion!.id, 'accept'), await asA(), {
        option: 1,
      });
      expect(accepted.statusCode).toBe(201);
      expect(accepted.json().adjustment).toMatchObject({ status: 'accepted', option: 1 });
      // One extra hour on the next study day, as a day override; the weekly pattern is untouched.
      expect(
        await rows<{ date: string; capacity_hours: string; is_study_day: boolean }>(
          `select date::text as date, capacity_hours, is_study_day from rnd.day_overrides where plan_id = $1`,
          [PLAN_A],
        ),
      ).toEqual([{ date: MON, capacity_hours: '3', is_study_day: true }]);
      expect(await hoursByWeekday()).toEqual({});
    });

    it('estimate drift: tasks of a type taking 50% longer update the estimates of the open ones only', async () => {
      clock = at(WED);
      const [suggestion] = await suggestions(PLAN_DRIFT);
      expect(suggestion!.rule).toBe('estimate_drift');
      expect(suggestion!.evidence.taskIds).toEqual(['d1', 'd2', 'd3']);

      const preview = await call('POST', sug(suggestion!.id, 'preview', PLAN_DRIFT), await asA());
      expect(preview.statusCode).toBe(200);
      expect(preview.json().summary.finishChanged).toBe(true);

      const accepted = await call('POST', sug(suggestion!.id, 'accept', PLAN_DRIFT), await asA(), {
        option: 0,
      });
      expect(accepted.statusCode).toBe(201);
      const est = await rows<{ id: string; est_hours: string }>(
        `select id, est_hours from rnd.tasks where plan_id = $1 order by sort_order`,
        [PLAN_DRIFT],
      );
      expect(est.map((t) => [t.id, Number(t.est_hours)])).toEqual([
        ['d1', 2],
        ['d2', 2],
        ['d3', 2],
        ['d4', 3],
        ['d5', 3],
      ]);
      // The finished tasks are evidence of an accepted suggestion and are not offered again.
      expect(await suggestions(PLAN_DRIFT)).toEqual([]);
    });

    it('estimate drift on an anchor that would end after 23:59 answers 422 and changes nothing', async () => {
      clock = at(WED);
      const [suggestion] = await suggestions(PLAN_ANCHOR);
      expect(suggestion!.rule).toBe('estimate_drift');
      const before = await rows(
        'select id, est_hours from rnd.tasks where plan_id = $1 order by id',
        [PLAN_ANCHOR],
      );
      const res = await call('POST', sug(suggestion!.id, 'accept', PLAN_ANCHOR), await asA(), {});
      expect(res.statusCode).toBe(422);
      expect(res.json().error.message).toMatch(/Anchor/);
      expect(
        await rows('select id, est_hours from rnd.tasks where plan_id = $1 order by id', [
          PLAN_ANCHOR,
        ]),
      ).toEqual(before);
      expect(await adjustmentRows(PLAN_ANCHOR)).toEqual([]);
      const preview = await call('POST', sug(suggestion!.id, 'preview', PLAN_ANCHOR), await asA());
      expect(preview.statusCode).toBe(422);
    });

    it('high difficulty: adds a practice task right after the next task of the same area', async () => {
      expect(
        (await putReview(SUN, { difficulty: 5, outcomes: [{ taskId: 'c1', outcome: 'done' }] }))
          .statusCode,
      ).toBe(201);
      const [suggestion] = await suggestions();
      expect(suggestion!.rule).toBe('difficulty_practice');
      expect(suggestion!.proposedChange).toMatchObject({
        kind: 'extraPractice',
        afterTaskId: 'c2',
      });

      const res = await call('POST', sug(suggestion!.id, 'accept'), await asA(), { option: 0 });
      expect(res.statusCode).toBe(201);
      const tasks = await rows<{ id: string; sort_order: number; source: string; type: string }>(
        `select id, sort_order, source, type from rnd.tasks where plan_id = $1 order by sort_order, id`,
        [PLAN_A],
      );
      expect(tasks.map((t) => t.id)).toEqual([
        'c1',
        'c2',
        `practice-${suggestion!.id}`,
        'c3',
        'c4',
        'c5',
        'c6',
        'c7',
        'c8',
      ]);
      const extra = tasks[2]!;
      expect(extra).toMatchObject({ source: 'auto', type: 'practice' });
      // The new task is part of the schedule now.
      const sched = await call('GET', `/plans/${PLAN_A}/schedule`, await asA());
      expect(sched.json().blocks.some((b: { taskId: string }) => b.taskId === extra.id)).toBe(true);
    });
  });

  describe('previewing and accepting', () => {
    it('density too high accepted: capacity drops by an hour and the finish date moves as the preview said', async () => {
      const suggestion = await heavyDays();
      expect(await finishDate()).toBe('2026-11-11');

      const preview = await call('POST', sug(suggestion.id, 'preview'), await asA());
      expect(preview.statusCode).toBe(200);
      const p = preview.json();
      expect(p).toMatchObject({
        suggestionId: suggestion.id,
        option: 0,
        currentFinishDate: '2026-11-11',
        proposedFinishDate: '2026-11-23',
      });
      expect(p.summary.text).toContain('plan finish pushed back by 8 study days');
      expect(p.summary.finishShiftStudyDays).toBe(8);

      const accepted = await call('POST', sug(suggestion.id, 'accept'), await asA(), { option: 0 });
      expect(accepted.statusCode).toBe(201);
      expect(accepted.json()).toMatchObject({
        replayed: false,
        adjustment: { suggestionId: suggestion.id, rule: 'density_too_high', status: 'accepted' },
        summary: p.summary,
      });
      expect(await hoursByWeekday()).toEqual({ '0': 1, '1': 1, '2': 1, '3': 1, '4': 1 });
      expect(await finishDate()).toBe('2026-11-23');
      // The suggestion is used up.
      expect((await suggestions()).map((s) => s.id)).not.toContain(suggestion.id);
    });

    it('is idempotent: a retry changes nothing, writes no second event or adjustment', async () => {
      const suggestion = await heavyDays();
      const first = await call('POST', sug(suggestion.id, 'accept'), await asA(), { option: 0 });
      expect(first.statusCode).toBe(201);
      const retry = await call('POST', sug(suggestion.id, 'accept'), await asA(), { option: 0 });
      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toMatchObject({ replayed: true, summary: first.json().summary });
      expect(retry.json().adjustment).toEqual(first.json().adjustment);
      // No body at all is the same as option 0.
      expect((await call('POST', sug(suggestion.id, 'accept'), await asA())).statusCode).toBe(200);

      expect(await adjustmentRows()).toHaveLength(1);
      expect(await eventCount('schedule.changed')).toBe(1);
      // Reduced once (2 -> 1), not twice (-> 0).
      expect(await hoursByWeekday()).toEqual({ '0': 1, '1': 1, '2': 1, '3': 1, '4': 1 });
      // Another option for the same, already accepted suggestion is a conflict, not a second change.
      const other = await call('POST', sug(suggestion.id, 'accept'), await asA(), { option: 1 });
      expect(other.statusCode).toBe(409);
    });

    it('survives two simultaneous accepts: one change, one adjustment, one event', async () => {
      const suggestion = await heavyDays();
      const headers = await asA();
      const results = await Promise.all([
        call('POST', sug(suggestion.id, 'accept'), headers, { option: 0 }),
        call('POST', sug(suggestion.id, 'accept'), headers, { option: 0 }),
        call('POST', sug(suggestion.id, 'accept'), headers, { option: 0 }),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 200, 201]);
      expect(await adjustmentRows()).toHaveLength(1);
      expect(await eventCount('schedule.changed')).toBe(1);
      expect(await hoursByWeekday()).toEqual({ '0': 1, '1': 1, '2': 1, '3': 1, '4': 1 });
    });

    it('waits for another writer of the same plan before it decides (plan row lock)', async () => {
      const suggestion = await heavyDays();
      const headers = await asA();
      const pending = Symbol('pending');
      const attempts: [string, () => Promise<{ statusCode: number }>][] = [
        ['accept', () => call('POST', sug(suggestion.id, 'accept'), headers, { option: 0 })],
        [
          'review',
          () => call('PUT', reviewUrl(MON), headers, body(MON, { density: 5, note: 'z' })),
        ],
      ];
      for (const [name, request] of attempts) {
        await testDb.admin(async (c) => {
          await c.query('begin');
          try {
            await c.query(`select 1 from rnd.plans where id = $1 for no key update`, [PLAN_A]);
            const result = request();
            const first = await Promise.race([
              result,
              new Promise((resolve) => setTimeout(() => resolve(pending), 400)),
            ]);
            expect(first, `${name} must wait for the lock`).toBe(pending);
            await c.query('commit');
            expect((await result).statusCode, name).toBeLessThan(300);
          } finally {
            await c.query('rollback').catch(() => undefined);
          }
        });
      }
    });

    it('does not block logging while a review or an accept holds the plan lock', async () => {
      await testDb.admin(async (c) => {
        await c.query('begin');
        try {
          await c.query(`select 1 from rnd.plans where id = $1 for no key update`, [PLAN_A]);
          const log = await call('POST', `/plans/${PLAN_A}/tasks/c1/logs`, await asA(), {
            id: LOG(7),
            date: SUN,
            hours: 1,
          });
          expect(log.statusCode).toBe(201);
        } finally {
          await c.query('rollback');
        }
      });
    });

    it('preview saves nothing: no settings, tasks, adjustments, reviews or events change', async () => {
      const suggestion = await heavyDays();
      // Freeze the past first so the only difference a preview could make is its own.
      await call('GET', `/plans/${PLAN_A}/schedule`, await asA());
      const snapshot = async () => ({
        patterns: await rows('select * from rnd.week_patterns order by plan_id'),
        overrides: await rows('select * from rnd.day_overrides order by plan_id, date'),
        tasks: await rows('select * from rnd.tasks order by plan_id, id'),
        adjustments: await rows('select * from rnd.adjustments order by plan_id'),
        reviews: await rows('select * from rnd.day_reviews order by plan_id, date'),
        events: await rows('select * from rnd.events order by created_at, id'),
        days: await rows('select * from rnd.schedule_days order by plan_id, date'),
        logs: await rows('select * from rnd.logs order by plan_id, id'),
      });
      const before = await snapshot();
      for (const url of [
        sug(suggestion.id, 'preview'),
        sug(suggestion.id, 'preview') + '?option=0',
      ]) {
        expect((await call('POST', url, await asA())).statusCode).toBe(200);
      }
      expect(await snapshot()).toEqual(before);
    });

    it('takes only the id and the option: a client-supplied change is refused and nothing is applied', async () => {
      const suggestion = await heavyDays();
      const before = await hoursByWeekday();
      for (const forged of [
        {
          option: 0,
          proposedChange: {
            kind: 'capacityDelta',
            scope: { type: 'weekdays', weekdays: [0] },
            hours: -2,
          },
        },
        { option: 0, hours: -2 },
        { change: { kind: 'estimateUpdate', taskType: 'course', factor: 0.5, taskIds: ['c1'] } },
        { user_id: B },
      ]) {
        const res = await call('POST', sug(suggestion.id, 'accept'), await asA(), forged);
        expect(res.statusCode, JSON.stringify(forged)).toBe(400);
      }
      expect(await hoursByWeekday()).toEqual(before);
      expect(await adjustmentRows()).toEqual([]);
      expect(await eventCount('schedule.changed')).toBe(0);
      // Query-string tricks are not read either: the recomputed change is what gets applied.
      const res = await call(
        'POST',
        sug(suggestion.id, 'accept') + '?hours=-2&proposedChange=x',
        await asA(),
        { option: 0 },
      );
      expect(res.statusCode).toBe(201);
      expect(await hoursByWeekday()).toEqual({ '0': 1, '1': 1, '2': 1, '3': 1, '4': 1 });
    });

    it('refuses an option the suggestion does not have (422) or a malformed one (400)', async () => {
      const suggestion = await heavyDays();
      expect(
        (await call('POST', sug(suggestion.id, 'accept'), await asA(), { option: 1 })).statusCode,
      ).toBe(422);
      expect(
        (await call('POST', sug(suggestion.id, 'preview') + '?option=1', await asA())).statusCode,
      ).toBe(422);
      expect(
        (await call('POST', sug(suggestion.id, 'accept'), await asA(), { option: -1 })).statusCode,
      ).toBe(400);
      expect(
        (await call('POST', sug(suggestion.id, 'accept'), await asA(), { option: 'a' })).statusCode,
      ).toBe(400);
      expect(
        (await call('POST', sug(suggestion.id, 'preview') + '?option=x', await asA())).statusCode,
      ).toBe(400);
      expect(await adjustmentRows()).toEqual([]);
    });

    it('refuses an unknown id and a stale one (the evidence changed) with 409 and changes nothing', async () => {
      const suggestion = await heavyDays();
      for (const verb of ['accept', 'reject', 'preview']) {
        const res = await call('POST', sug('sg_00000000000000', verb), await asA(), {});
        expect(res.statusCode, verb).toBe(409);
      }
      expect((await call('POST', sug('has%20spaces', 'accept'), await asA(), {})).statusCode).toBe(
        400,
      );

      // Monday's review is lowered within the edit window: the evidence for the suggestion is gone.
      expect((await putReview(MON, { density: 2 })).statusCode).toBe(200);
      const before = await hoursByWeekday();
      for (const verb of ['accept', 'reject', 'preview']) {
        const res = await call('POST', sug(suggestion.id, verb), await asA(), {});
        expect(res.statusCode, verb).toBe(409);
        expect(res.json().error.code).toBe('conflict');
      }
      expect(await hoursByWeekday()).toEqual(before);
      expect(await adjustmentRows()).toEqual([]);
      expect(await eventCount('schedule.changed')).toBe(0);
    });
  });

  describe('rejecting', () => {
    it('is stored, hides the suggestion, is idempotent and cannot be undone by accepting', async () => {
      const suggestion = await heavyDays();
      const before = await hoursByWeekday();
      const first = await call('POST', sug(suggestion.id, 'reject'), await asA(), {});
      expect(first.statusCode).toBe(201);
      expect(first.json()).toMatchObject({
        replayed: false,
        summary: null,
        adjustment: { status: 'rejected', option: null, rule: 'density_too_high' },
      });
      expect((await suggestions()).map((s) => s.id)).not.toContain(suggestion.id);
      expect((await call('POST', sug(suggestion.id, 'reject'), await asA())).statusCode).toBe(200);
      expect(await adjustmentRows()).toHaveLength(1);

      const accept = await call('POST', sug(suggestion.id, 'accept'), await asA(), { option: 0 });
      expect(accept.statusCode).toBe(409);
      expect(await hoursByWeekday()).toEqual(before);
      expect(await eventCount('schedule.changed')).toBe(0);
      expect(await eventCount('suggestion.rejected')).toBe(1);
      const [stored] = await rows<{ evidence: unknown }>('select evidence from rnd.adjustments');
      expect(stored!.evidence).toEqual(suggestion.evidence);
    });

    it('does not re-offer the same evidence, but new evidence gives a new suggestion', async () => {
      const suggestion = await heavyDays();
      await call('POST', sug(suggestion.id, 'reject'), await asA(), {});
      expect(await suggestions()).toEqual([]);
      // Another heavy day: a new pair of study days, so a new key and a new id.
      clock = at(TUE);
      const res = await putReview(TUE, { density: 5 });
      expect(res.statusCode).toBe(201);
      const open = await suggestions();
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({ rule: 'density_too_high' });
      expect(open[0]!.id).not.toBe(suggestion.id);
      expect(open[0]!.evidence.reviewDates).toEqual([MON, TUE]);
    });

    it('stops suggesting a reduction at one hour a day', async () => {
      const suggestion = await heavyDays();
      await call('POST', sug(suggestion.id, 'accept'), await asA(), { option: 0 });
      clock = at(TUE);
      await putReview(TUE, { density: 5 });
      clock = at(WED);
      await putReview(WED, { density: 5 });
      expect(await suggestions()).toEqual([]);
    });

    it('does not reuse the evidence of an accepted suggestion', async () => {
      // Three hours a day, so there is room for a second reduction.
      await rows('update rnd.week_patterns set default_hours = 3 where plan_id = $1', [PLAN_A]);
      const suggestion = await heavyDays();
      await call('POST', sug(suggestion.id, 'accept'), await asA(), { option: 0 });
      clock = at(TUE);
      await putReview(TUE, { density: 5 });
      // Monday was already used by the accepted suggestion, so Tuesday alone is not enough...
      expect(await suggestions()).toEqual([]);
      clock = at(WED);
      await putReview(WED, { density: 5 });
      // ...but two fresh heavy days in a row are.
      const open = await suggestions();
      expect(open).toHaveLength(1);
      expect(open[0]!.evidence.reviewDates).toEqual([TUE, WED]);
    });

    it('answers 400 for a body that is not empty', async () => {
      const suggestion = await heavyDays();
      const res = await call('POST', sug(suggestion.id, 'reject'), await asA(), { reason: 'x' });
      expect(res.statusCode).toBe(400);
      expect(await adjustmentRows()).toEqual([]);
    });
  });

  describe('events and the log', () => {
    it('writes schedule.changed once with the summary and no free text', async () => {
      const suggestion = await heavyDays();
      await putReview(MON, { density: 5, note: 'my private note' });
      await call('POST', sug(suggestion.id, 'accept'), await asA(), { option: 0 });
      const events = await rows<{ payload: Record<string, unknown>; user_id: string }>(
        `select payload, user_id from rnd.events where type = 'schedule.changed'`,
      );
      expect(events).toHaveLength(1);
      expect(events[0]!.user_id).toBe(A);
      expect(events[0]!.payload).toMatchObject({
        source: 'adjustment',
        suggestionId: suggestion.id,
        rule: 'density_too_high',
        option: 0,
        finishBefore: '2026-11-11',
        finishAfter: '2026-11-23',
      });
      expect(JSON.stringify(await rows('select payload from rnd.events'))).not.toContain(
        'my private note',
      );
    });

    it('lists no suggestions for a plan without reviews', async () => {
      clock = at(THU);
      expect(await suggestions()).toEqual([]);
    });
  });
});
