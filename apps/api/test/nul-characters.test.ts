import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createDatabase, type Database } from '../src/db/database';
import { errorResponseSchema } from '../src/errors';
import { createSupabaseVerifier } from '../src/modules/accounts/token-verifier';
import { containsNul, NO_NUL_MESSAGE } from '../src/validation';
import { acceptCurrentLegal, dbAvailable, prepareDatabase, type TestDb } from './db-helpers';
import { testConfig } from './helpers';
import { ISSUER, makeTestKeys, type TestKeys } from './tokens';

const A = '11111111-1111-4111-8111-111111111111';
const PLAN = 'a0000000-0000-4000-8000-0000000000a1';
const NEW_PLAN = 'a0000000-0000-4000-8000-0000000000a2';
const LOG = 'b0000000-0000-4000-8000-0000000000b1';
const NUL = '\u0000';

const demo = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../data/sample-plans/demo-plan.json', import.meta.url)),
    'utf8',
  ),
) as Record<string, unknown> & { tasks: Record<string, unknown>[] };

describe('containsNul', () => {
  it('finds a NUL in strings, arrays and nested objects, and nowhere else', () => {
    expect(containsNul(`a${NUL}b`)).toBe(true);
    expect(containsNul(['ok', { deep: [{ deeper: `x${NUL}` }] }])).toBe(true);
    expect(containsNul({ [`k${NUL}`]: 'v' })).toBe(true);
    expect(containsNul({ a: 'text', b: 3, c: null, d: [true, 'é\n\t'] })).toBe(false);
    expect(containsNul('\\u0000 written out, not a character')).toBe(false);
  });
});

describe.skipIf(!dbAvailable)('NUL characters in free text (real Postgres)', () => {
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

  beforeEach(async () => {
    await testDb.admin(async (c) => {
      await c.query('delete from rnd.app_users');
      await c.query('delete from rnd.allowed_emails');
      await c.query(`insert into rnd.allowed_emails (email) values ('a@example.com')`);
      await c.query(`insert into rnd.app_users (id, email) values ($1, 'a@example.com')`, [A]);
      await acceptCurrentLegal(c, [A]);
      await c.query(
        `insert into rnd.plans (user_id, id, created_from, name, start_date)
         values ($1, $2, 'builder', 'Plan', '2026-11-01')`,
        [A, PLAN],
      );
      await c.query(
        `insert into rnd.tasks (user_id, plan_id, id, title, type, est_hours, sort_order)
         values ($1, $2, 't1', 'Task one', 'course', 3, 0)`,
        [A, PLAN],
      );
    });
  });

  const headers = async () => ({
    authorization: `Bearer ${await keys.sign({ sub: A, email: 'a@example.com' })}`,
  });
  const send = async (method: 'GET' | 'PATCH' | 'POST' | 'DELETE', url: string, payload?: object) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: await headers(),
      ...(payload === undefined ? {} : { payload }),
    });
  const n = (sql: string) => testDb.admin(async (c) => (await c.query(sql)).rows[0].n as number);

  const expect422 = (res: { statusCode: number; json(): unknown; headers: object }) => {
    expect(res.statusCode).toBe(422);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error.code).toBe('unprocessable');
    expect(body.error.message).toBe(NO_NUL_MESSAGE);
    expect(body.error.requestId).toBe((res.headers as Record<string, string>)['x-request-id']);
  };

  describe('PATCH /me', () => {
    it('answers 422 and keeps the name', async () => {
      expect422(await send('PATCH', '/me', { displayName: `Ada${NUL}` }));
      expect(
        await n(`select count(*)::int as n from rnd.app_users where display_name is not null`),
      ).toBe(0);
    });
  });

  describe('PATCH a task', () => {
    it.each([
      ['title', { title: `T${NUL}` }],
      ['provider', { provider: `P${NUL}` }],
      ['certificateName', { certificateName: `C${NUL}` }],
      ['promptTemplate', { promptTemplate: `x${NUL}` }],
      ['practiceKind', { practiceKind: `x${NUL}` }],
      ['notes', { notes: `n${NUL}` }],
      ['a dependency id', { dependsOn: [`d${NUL}`] }],
      ['a how-to step', { howToSteps: ['ok', `s${NUL}`] }],
      ['a lesson title', { lessons: [{ title: `L${NUL}` }] }],
      ['a lesson summary', { lessons: [{ title: 'L', summary: `s${NUL}` }] }],
    ])('answers 422 for a NUL in %s and changes nothing', async (_label, patch) => {
      expect422(await send('PATCH', `/plans/${PLAN}/tasks/t1`, patch));
      expect(await n(`select count(*)::int as n from rnd.tasks where title <> 'Task one'`)).toBe(0);
    });

    it('still accepts ordinary text, including accents and new lines', async () => {
      const res = await send('PATCH', `/plans/${PLAN}/tasks/t1`, { notes: 'Café\nline two' });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('POST a log', () => {
    it.each([
      ['note', { note: `n${NUL}` }],
      ['result', { result: `r${NUL}` }],
    ])('answers 422 for a NUL in the %s and stores no log', async (_label, extra) => {
      const res = await send('POST', `/plans/${PLAN}/tasks/t1/logs`, {
        id: LOG,
        date: '2026-11-03',
        hours: 1,
        ...extra,
      });
      expect422(res);
      expect(await n('select count(*)::int as n from rnd.logs')).toBe(0);
    });
  });

  describe('a task id in the path', () => {
    it.each([
      ['GET', ''],
      ['PATCH', ''],
      ['POST', '/logs'],
      ['POST', '/complete'],
      ['POST', '/reopen'],
      ['POST', '/skip'],
    ] as const)('%s …/tasks/<id with NUL>%s answers 422, not 500', async (method, suffix) => {
      const payload =
        method === 'GET'
          ? undefined
          : suffix === '/logs'
            ? { id: LOG, date: '2026-11-03', hours: 1 }
            : method === 'PATCH'
              ? { notes: 'x' }
              : {};
      const res = await send(method, `/plans/${PLAN}/tasks/t%001${suffix}`, payload);
      expect422(res);
    });
  });

  describe('POST /plans/import', () => {
    const task = demo.tasks[0]!;
    const file = { id: NEW_PLAN, ...demo };

    it.each([
      ['the plan name', { name: `Plan${NUL}` }],
      ['a task title', { tasks: [{ ...task, title: `T${NUL}` }] }],
      ['a task id', { tasks: [{ ...task, id: `t${NUL}` }] }],
      ['a lesson', { tasks: [{ ...task, lessons: [{ title: `L${NUL}` }] }] }],
    ])('answers 422 for a NUL in %s and stores nothing', async (_label, patch) => {
      const res = await send('POST', '/plans/import', { ...file, ...patch });
      expect(res.statusCode).toBe(422);
      expect(errorResponseSchema.parse(res.json()).error.code).toBe('unprocessable');
      expect(await n(`select count(*)::int as n from rnd.plans where id = '${NEW_PLAN}'`)).toBe(0);
    });
  });

  describe('DELETE /me', () => {
    it('answers 422 for a confirmation with a NUL and deletes nothing', async () => {
      const res = await send('DELETE', '/me', { confirmation: `delete my account${NUL}` });
      expect422(res);
      expect(await n('select count(*)::int as n from rnd.app_users')).toBe(1);
    });
  });
});
