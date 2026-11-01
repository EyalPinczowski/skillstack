import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ENVS,
  TEST_DATABASE_URL,
  TEST_SUPERUSER_URL,
  asUser,
  dbAvailable,
  prepareEnvironments,
  withClient,
  type TestEnvironments,
} from './helpers';

// Migrations 0009 (practice) and 0010 (AI usage): behaviour that the generic per-table tests in
// data-model.test.ts do not cover. Runs on both schemas, so prod gets the same checks as rnd.

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const PLAN_A = 'a0000000-0000-4000-8000-000000000001';
const PLAN_B = 'b0000000-0000-4000-8000-000000000002';
const PLAN_B2 = 'b0000000-0000-4000-8000-000000000003';
const SESSION_A = 'a0000000-0000-4000-8000-0000000000c1';
const SESSION_B = 'b0000000-0000-4000-8000-0000000000c2';
const SESSION_B2 = 'b0000000-0000-4000-8000-0000000000c3';

const NO_PRIVILEGE = /permission denied for table/;
const hex = (c: string) => c.repeat(64);

for (const schema of ENVS) {
  describe.skipIf(!dbAvailable)(`practice and AI usage tables (${schema})`, () => {
    const s = schema;
    const appRole = `app_${s}_user`;
    let env: TestEnvironments;

    /** Runs `work` as the backend does, committing (needed for real concurrency). */
    async function committed<T>(sub: string | null, work: (c: pg.Client) => Promise<T>) {
      return withClient(env.appUrl(s), async (client) => {
        await client.query('begin');
        try {
          await client.query(`set local role ${appRole}`);
          if (sub) {
            await client.query(`select set_config('request.jwt.claims', $1, true)`, [
              JSON.stringify({ sub }),
            ]);
          }
          const result = await work(client);
          await client.query('commit');
          return result;
        } catch (error) {
          await client.query('rollback');
          throw error;
        }
      });
    }

    /** A statement run as the owner role in a transaction that is always rolled back. */
    async function asOwnerRolledBack(sql: string) {
      return withClient(TEST_SUPERUSER_URL!, async (client) => {
        await client.query('begin');
        try {
          await client.query(`set local role owner_${s}`);
          await client.query(sql);
        } finally {
          await client.query('rollback');
        }
      });
    }

    const session = (id: string, planId = PLAN_B, columns = '', values = '') =>
      `insert into ${s}.practice_sessions (user_id, id, plan_id, task_id, practice_kind, persona,
       channel, planned_minutes, prompt_used${columns})
     values ('${USER_B}', '${id}', '${planId}', 't1', 'mock_interview', 'interviewer',
       'in_app', 30, 'p'${values})`;

    beforeAll(async () => {
      env = await prepareEnvironments();
      await withClient(TEST_DATABASE_URL!, async (client) => {
        await client.query('begin');
        await client.query(`set local role owner_${s}`);
        await client.query(`
        insert into ${s}.app_users (id, email) values
          ('${USER_A}', 'a@example.test'), ('${USER_B}', 'b@example.test');
        insert into ${s}.plans (user_id, id, created_from, name, start_date) values
          ('${USER_A}', '${PLAN_A}', 'builder', 'Plan A', '2026-01-01'),
          ('${USER_B}', '${PLAN_B}', 'builder', 'Plan B', '2026-01-01'),
          ('${USER_B}', '${PLAN_B2}', 'builder', 'Plan B2', '2026-01-01');
        insert into ${s}.tasks (user_id, plan_id, id, title, type, est_hours, sort_order) values
          ('${USER_A}', '${PLAN_A}', 't1', 'A task', 'practice', 1, 0),
          ('${USER_B}', '${PLAN_B}', 't1', 'B task', 'practice', 1, 0);
        insert into ${s}.practice_sessions (user_id, id, plan_id, task_id, practice_kind, persona,
          channel, status, planned_minutes, ended_at, prompt_used) values
          ('${USER_A}', '${SESSION_A}', '${PLAN_A}', 't1', 'mock_interview', 'interviewer',
            'in_app', 'finished', 30, now(), 'prompt A'),
          ('${USER_B}', '${SESSION_B}', '${PLAN_B}', 't1', 'mock_interview', 'interviewer',
            'in_app', 'finished', 30, now(), 'prompt B'),
          ('${USER_B}', '${SESSION_B2}', '${PLAN_B}', 't1', 'mock_interview', 'interviewer',
            'self', 'finished', 30, now(), 'prompt B2');
        insert into ${s}.practice_messages (user_id, session_id, id, seq, role, content) values
          ('${USER_A}', '${SESSION_A}', gen_random_uuid(), 0, 'user', 'hello A'),
          ('${USER_B}', '${SESSION_B}', gen_random_uuid(), 0, 'user', 'hello B');
        insert into ${s}.practice_feedback (user_id, session_id, source, score) values
          ('${USER_A}', '${SESSION_A}', 'model_json', 7),
          ('${USER_B}', '${SESSION_B}', 'pasted_block', 6);
        insert into ${s}.practice_contexts (user_id, plan_id, job_description) values
          ('${USER_A}', '${PLAN_A}', 'job of A'),
          ('${USER_B}', '${PLAN_B}', 'job of B');
        insert into ${s}.ai_provider_usage (day, provider_id, requests) values
          ('2020-01-05', 'old', 4);
      `);
        await client.query('commit');
      });
    });

    it('keeps one user from reading, writing or attaching to the other user’s practice rows', async () => {
      await withClient(env.appUrl(s), async (client) => {
        for (const table of [
          'practice_contexts',
          'practice_sessions',
          'practice_messages',
          'practice_feedback',
        ]) {
          const own = await asUser(client, s, USER_B, () =>
            client.query(`select user_id from ${s}.${table}`),
          );
          // Not vacuous: user B has a row in every one of these tables.
          expect(own.rows.length, table).toBeGreaterThan(0);
          expect(
            own.rows.every((r) => r.user_id === USER_B),
            table,
          ).toBe(true);
          const other = await asUser(client, s, USER_B, () =>
            client.query(`select 1 from ${s}.${table} where user_id = $1`, [USER_A]),
          );
          expect(other.rows, table).toEqual([]);
        }
        // A forged user_id is refused by RLS; a foreign session or plan by the composite FK.
        await expect(
          asUser(client, s, USER_A, () =>
            client.query(session('b0000000-0000-4000-8000-0000000000d9')),
          ),
        ).rejects.toThrow(/row-level security policy/);
        await expect(
          asUser(client, s, USER_A, () =>
            client.query(
              `insert into ${s}.practice_messages (user_id, session_id, id, seq, role, content)
             values ('${USER_A}', '${SESSION_B}', gen_random_uuid(), 5, 'user', 'x')`,
            ),
          ),
        ).rejects.toThrow(/violates foreign key constraint/);
        await expect(
          asUser(client, s, USER_A, () =>
            client.query(
              `insert into ${s}.practice_feedback (user_id, session_id, source)
             values ('${USER_A}', '${SESSION_B2}', 'self_rubric')`,
            ),
          ),
        ).rejects.toThrow(/violates foreign key constraint/);
        await expect(
          asUser(client, s, USER_A, () =>
            client.query(
              `insert into ${s}.practice_contexts (user_id, plan_id) values ('${USER_A}', '${PLAN_B}')`,
            ),
          ),
        ).rejects.toThrow(/violates foreign key constraint/);
      });
    });

    it('denies UPDATE and DELETE on append-only and no-delete tables, with only SELECT and INSERT policies', async () => {
      await withClient(env.appUrl(s), async (client) => {
        for (const sql of [
          `update ${s}.practice_messages set content = 'x' where user_id = '${USER_A}'`,
          `delete from ${s}.practice_messages where user_id = '${USER_A}'`,
          `update ${s}.practice_feedback set score = 10 where user_id = '${USER_A}'`,
          `delete from ${s}.practice_feedback where user_id = '${USER_A}'`,
          `delete from ${s}.practice_sessions where user_id = '${USER_A}'`,
          `delete from ${s}.practice_contexts where user_id = '${USER_A}'`,
          `delete from ${s}.ai_usage_daily where user_id = '${USER_A}'`,
        ]) {
          await expect(
            asUser(client, s, USER_A, () => client.query(sql)),
            sql,
          ).rejects.toThrow(NO_PRIVILEGE);
        }
      });
      await withClient(TEST_SUPERUSER_URL!, async (client) => {
        const { rows } = await client.query<{ relname: string; polcmd: string }>(
          `select c.relname, p.polcmd from pg_policy p join pg_class c on c.oid = p.polrelid
          where c.relname in ('practice_messages', 'practice_feedback')
            and c.relnamespace = $1::regnamespace
            and $2::regrole::oid = any (p.polroles)
          order by 1, 2`,
          [s, appRole],
        );
        expect(rows.map((r) => `${r.relname}:${r.polcmd}`)).toEqual([
          'practice_feedback:a',
          'practice_feedback:r',
          'practice_messages:a',
          'practice_messages:r',
        ]);
      });
    });

    it('lets the app change only the granted practice_sessions and practice_contexts columns', async () => {
      await withClient(env.appUrl(s), async (client) => {
        const ok = await asUser(client, s, USER_A, () =>
          client.query(
            `update ${s}.practice_sessions
              set status = 'finished', pending_turn_id = gen_random_uuid(),
                  pending_since = now(), providers_used = '{fake}'
            where user_id = $1`,
            [USER_A],
          ),
        );
        expect(ok.rowCount).toBe(1);
        for (const column of [
          `task_id = 't9'`,
          `practice_kind = 'other'`,
          `channel = 'self'`,
          `prompt_used = 'new'`,
          `prompt_inputs = '{}'`,
          `planned_minutes = 5`,
          `started_at = now()`,
          `persona = 'x'`,
          `plan_id = '${PLAN_B}'`,
          `user_id = '${USER_B}'`,
          `id = gen_random_uuid()`,
        ]) {
          await expect(
            asUser(client, s, USER_A, () =>
              client.query(`update ${s}.practice_sessions set ${column} where user_id = $1`, [
                USER_A,
              ]),
            ),
            column,
          ).rejects.toThrow(NO_PRIVILEGE);
        }
        for (const column of [`plan_id = '${PLAN_B}'`, `user_id = '${USER_B}'`]) {
          await expect(
            asUser(client, s, USER_A, () =>
              client.query(`update ${s}.practice_contexts set ${column} where user_id = $1`, [
                USER_A,
              ]),
            ),
            column,
          ).rejects.toThrow(NO_PRIVILEGE);
        }
        const text = await asUser(client, s, USER_A, () =>
          client.query(
            `update ${s}.practice_contexts set job_description = '', updated_at = now() where user_id = $1`,
            [USER_A],
          ),
        );
        expect(text.rowCount).toBe(1);
      });
    });

    it('allows at most one active session per task', async () => {
      await withClient(TEST_SUPERUSER_URL!, async (client) => {
        await client.query('begin');
        try {
          await client.query(`set local role owner_${s}`);
          await client.query(session('b0000000-0000-4000-8000-0000000000d1'));
          await expect(
            client.query(session('b0000000-0000-4000-8000-0000000000d2')),
          ).rejects.toThrow(/practice_sessions_one_active_idx/);
        } finally {
          await client.query('rollback');
        }
      });
    });

    it.each([
      [
        'unknown channel',
        session('b0000000-0000-4000-8000-0000000000d3').replace(`'in_app'`, `'pigeon'`),
      ],
      [
        'unknown status',
        session('b0000000-0000-4000-8000-0000000000d3', PLAN_B, ', status', `, 'weird'`),
      ],
      ['zero minutes', session('b0000000-0000-4000-8000-0000000000d3').replace(', 30,', ', 0,')],
      [
        'array prompt_inputs',
        session('b0000000-0000-4000-8000-0000000000d3', PLAN_B, ', prompt_inputs', `, '[]'`),
      ],
      [
        'active with an end time',
        session('b0000000-0000-4000-8000-0000000000d3', PLAN_B, ', ended_at', ', now()'),
      ],
      [
        'marker without time',
        session(
          'b0000000-0000-4000-8000-0000000000d3',
          PLAN_B,
          ', pending_turn_id',
          ', gen_random_uuid()',
        ),
      ],
      ['unknown task', session('b0000000-0000-4000-8000-0000000000d3').replace(`'t1'`, `'nope'`)],
      ['task of another plan', session('b0000000-0000-4000-8000-0000000000d3', PLAN_B2)],
      [
        'unknown message role',
        `insert into ${s}.practice_messages (user_id, session_id, id, seq, role, content)
       values ('${USER_B}', '${SESSION_B}', gen_random_uuid(), 5, 'robot', 'x')`,
      ],
      [
        'message too long',
        `insert into ${s}.practice_messages (user_id, session_id, id, seq, role, content)
       values ('${USER_B}', '${SESSION_B}', gen_random_uuid(), 5, 'user', '${'x'.repeat(8001)}')`,
      ],
      [
        'duplicate seq in a session',
        `insert into ${s}.practice_messages (user_id, session_id, id, seq, role, content)
       values ('${USER_B}', '${SESSION_B}', gen_random_uuid(), 0, 'user', 'dup')`,
      ],
      [
        'score above 10',
        `insert into ${s}.practice_feedback (user_id, session_id, source, score)
       values ('${USER_B}', '${SESSION_B2}', 'self_rubric', 11)`,
      ],
      [
        'unknown feedback source',
        `insert into ${s}.practice_feedback (user_id, session_id, source)
       values ('${USER_B}', '${SESSION_B2}', 'telepathy')`,
      ],
      [
        'second feedback for a session',
        `insert into ${s}.practice_feedback (user_id, session_id, source)
       values ('${USER_B}', '${SESSION_B}', 'self_rubric')`,
      ],
      [
        'job description too long',
        `insert into ${s}.practice_contexts (user_id, plan_id, job_description)
       values ('${USER_B}', '${PLAN_B2}', '${'x'.repeat(8001)}')`,
      ],
    ])('refuses a bad row: %s', async (_label, sql) => {
      await expect(asOwnerRolledBack(sql)).rejects.toThrow(
        /violates (check|foreign key|unique)|duplicate key|unique constraint/,
      );
    });

    it('keeps provider names out of every constraint (provider ids are free text)', async () => {
      await withClient(TEST_SUPERUSER_URL!, async (client) => {
        const { rows } = await client.query<{ def: string }>(
          `select pg_get_constraintdef(c.oid) as def
           from pg_constraint c join pg_class t on t.oid = c.conrelid
          where c.connamespace = $1::regnamespace and c.contype = 'c'
            and t.relname in ('practice_sessions', 'practice_messages', 'practice_feedback',
                              'ai_usage_daily', 'ai_cache', 'ai_provider_usage')`,
          [s],
        );
        expect(rows.length).toBeGreaterThan(10);
        const all = rows.map((r) => r.def.toLowerCase()).join('\n');
        for (const name of [
          'groq',
          'cloudflare',
          'gemini',
          'openrouter',
          'github',
          'fake',
          'claude',
        ]) {
          expect(all, name).not.toContain(name);
        }
      });
    });

    it('refuses bad ai_usage_daily, ai_cache and ai_provider_usage rows', async () => {
      for (const sql of [
        `insert into ${s}.ai_usage_daily (user_id, day, purpose) values ('${USER_A}', '2026-02-02', 'chit_chat')`,
        `insert into ${s}.ai_usage_daily (user_id, day, purpose, requests) values ('${USER_A}', '2026-02-02', 'day_overview', -1)`,
        `insert into ${s}.ai_cache (user_id, key, purpose, text, expires_at) values ('${USER_A}', 'short', 'day_overview', 't', now() + interval '1 day')`,
        `insert into ${s}.ai_cache (user_id, key, purpose, text, expires_at) values ('${USER_A}', '${hex('d')}', 'day_overview', '${'x'.repeat(8001)}', now() + interval '1 day')`,
        `insert into ${s}.ai_cache (user_id, key, purpose, text, created_at, expires_at) values ('${USER_A}', '${hex('d')}', 'day_overview', 't', now(), now() - interval '1 day')`,
        `insert into ${s}.ai_provider_usage (day, provider_id) values ('2026-02-02', 'Bad Id!')`,
      ]) {
        await expect(asOwnerRolledBack(sql), sql).rejects.toThrow(/violates check constraint/);
      }
    });

    it('reserves the per-user cap atomically (ON CONFLICT ... WHERE requests < cap) under 20 connections', async () => {
      const cap = 5;
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          committed(USER_A, async (client) => {
            const r = await client.query(
              `insert into ${s}.ai_usage_daily as u (user_id, day, purpose, requests)
             values ($1, '2026-02-01', 'practice_message', 1)
             on conflict (user_id, day, purpose) do update set requests = u.requests + 1
               where u.requests < $2
             returning requests`,
              [USER_A, cap],
            );
            return r.rowCount ?? 0;
          }),
        ),
      );
      expect(results.reduce((a, b) => a + b, 0)).toBe(cap);
      const { rows } = await withClient(TEST_SUPERUSER_URL!, (c) =>
        c.query(`select requests from ${s}.ai_usage_daily where day = '2026-02-01'`),
      );
      expect(rows).toEqual([{ requests: cap }]);
    });

    it('lets a user prune only their own ai_cache rows', async () => {
      await withClient(TEST_SUPERUSER_URL!, async (c) => {
        await c.query(`set role owner_${s}`);
        await c.query(
          `insert into ${s}.ai_cache (user_id, key, purpose, text, created_at, expires_at) values
           ('${USER_A}', '${hex('1')}', 'day_overview', 'a', now() - interval '2 days', now() - interval '1 day'),
           ('${USER_B}', '${hex('2')}', 'day_overview', 'b', now() - interval '2 days', now() - interval '1 day')`,
        );
      });
      const del = await committed(USER_A, (client) =>
        client.query(`delete from ${s}.ai_cache where expires_at < now()`),
      );
      expect(del.rowCount).toBe(1);
      const { rows } = await withClient(TEST_SUPERUSER_URL!, (c) =>
        c.query(`select user_id from ${s}.ai_cache`),
      );
      expect(rows).toEqual([{ user_id: USER_B }]);
    });

    describe('ai_provider_usage and its two SECURITY DEFINER functions', () => {
      const used = (provider: string) =>
        withClient(TEST_SUPERUSER_URL!, async (c) => {
          const r = await c.query(
            `select coalesce(sum(requests), 0)::int as n from ${s}.ai_provider_usage
            where provider_id = $1 and day = (now() at time zone 'utc')::date`,
            [provider],
          );
          return r.rows[0].n as number;
        });
      const reserve = (sub: string | null, provider: string, budget: number) =>
        committed(sub, async (client) => {
          const r = await client.query<{ ok: boolean }>(
            `select ${s}.ai_reserve_provider($1, $2) as ok`,
            [provider, budget],
          );
          return r.rows[0]!.ok;
        });

      it('gives the app no privilege and no policy on the table itself', async () => {
        await withClient(env.appUrl(s), async (client) => {
          for (const sql of [
            `select * from ${s}.ai_provider_usage`,
            `insert into ${s}.ai_provider_usage (day, provider_id, requests) values ('2026-01-05', 'x', 1)`,
            `update ${s}.ai_provider_usage set requests = 0`,
            `delete from ${s}.ai_provider_usage`,
          ]) {
            await expect(
              asUser(client, s, USER_A, () => client.query(sql)),
              sql,
            ).rejects.toThrow(NO_PRIVILEGE);
          }
        });
        await withClient(TEST_SUPERUSER_URL!, async (client) => {
          const { rows } = await client.query(
            `select 1 from pg_policy p
            where p.polrelid = $1::regclass and $2::regrole::oid = any (p.polroles)`,
            [`${s}.ai_provider_usage`, appRole],
          );
          expect(rows).toEqual([]);
        });
      });

      it('never exceeds the budget under 20 concurrent calls', async () => {
        const results = await Promise.all(
          Array.from({ length: 20 }, () => reserve(USER_A, 'burst', 7)),
        );
        expect(results.filter(Boolean)).toHaveLength(7);
        expect(await used('burst')).toBe(7);
      });

      it('counts until the budget, then says false; a budget outside 1..1000000 never writes', async () => {
        expect([
          await reserve(USER_A, 'seq', 2),
          await reserve(USER_B, 'seq', 2),
          await reserve(USER_A, 'seq', 2),
        ]).toEqual([true, true, false]);
        expect(await used('seq')).toBe(2);
        for (const budget of [0, -3, 1_000_001]) {
          expect(await reserve(USER_A, 'zero', budget), String(budget)).toBe(false);
        }
        expect(await used('zero')).toBe(0);
      });

      it('refuses without a user context or with a bad provider id', async () => {
        expect(await reserve(null, 'nouser', 5)).toBe(false);
        for (const bad of ['', 'UPPER', 'has space', "x'; drop table t; --", 'a'.repeat(65)]) {
          expect(await reserve(USER_A, bad, 5), bad).toBe(false);
        }
      });

      it('does not let the caller choose the day: the old three-argument form does not exist', async () => {
        await expect(
          committed(USER_A, (client) =>
            client.query(`select ${s}.ai_reserve_provider('dayless', '2020-01-01'::date, 5)`),
          ),
        ).rejects.toThrow(/function .* does not exist/);
        expect(await used('dayless')).toBe(0);
        // A reservation always lands on today's UTC day.
        expect(await reserve(USER_A, 'dayless', 5)).toBe(true);
        expect(await used('dayless')).toBe(1);
      });

      it('is executable only after SET ROLE to the user role, never by PUBLIC or the login role', async () => {
        await withClient(env.appUrl(s), async (client) => {
          await expect(client.query(`select ${s}.ai_reserve_provider('x', 1)`)).rejects.toThrow(
            /permission denied for function/,
          );
          await expect(
            client.query(`select * from ${s}.ai_provider_usage_today()`),
          ).rejects.toThrow(/permission denied for function/);
        });
      });

      it('shows today’s counters (the same UTC day as the reserve) to a signed-in user, nothing to anyone else, and not other days', async () => {
        // Independent of other tests: reserve here, then read it back.
        expect(await reserve(USER_A, 'meter', 9)).toBe(true);
        expect(await reserve(USER_A, 'meter', 9)).toBe(true);
        const rows = await committed(USER_B, async (client) => {
          const r = await client.query(
            `select provider_id, requests from ${s}.ai_provider_usage_today() order by 1`,
          );
          return r.rows;
        });
        const ids = rows.map((r) => r.provider_id);
        expect(ids).not.toContain('old');
        expect(rows.find((r) => r.provider_id === 'meter')?.requests).toBe(2);
        expect(Object.keys(rows[0]!).sort()).toEqual(['provider_id', 'requests']);
        const none = await committed(null, async (client) => {
          const r = await client.query(`select * from ${s}.ai_provider_usage_today()`);
          return r.rows;
        });
        expect(none).toEqual([]);
      });
    });

    it('never lets a usage counter go down, but lets it go up', async () => {
      await withClient(TEST_SUPERUSER_URL!, async (c) => {
        await c.query(`set role owner_${s}`);
        await c.query(
          `insert into ${s}.ai_usage_daily (user_id, day, purpose, requests, avoided)
           values ('${USER_B}', '2026-03-01', 'practice_feedback', 3, 2)`,
        );
      });
      const set = (sql: string) => committed(USER_B, (c) => c.query(sql));
      const where = `where user_id = '${USER_B}' and day = '2026-03-01'`;
      for (const assign of ['requests = 2', 'avoided = 1', 'requests = 0, avoided = 0']) {
        await expect(
          set(`update ${s}.ai_usage_daily set ${assign} ${where}`),
          assign,
        ).rejects.toThrow(/counters cannot decrease/);
      }
      await set(`update ${s}.ai_usage_daily set requests = 4, avoided = 2 ${where}`);
      await set(`update ${s}.ai_usage_daily set requests = requests ${where}`);
    });

    it('keeps finished and abandoned sessions final', async () => {
      await withClient(TEST_SUPERUSER_URL!, async (c) => {
        await c.query(`set role owner_${s}`);
        await c.query(
          `insert into ${s}.practice_sessions (user_id, id, plan_id, task_id, practice_kind, persona,
             channel, status, planned_minutes, ended_at, prompt_used) values
           ('${USER_B}', 'b0000000-0000-4000-8000-0000000000e1', '${PLAN_B}', 't1', 'k', 'p',
             'self', 'abandoned', 5, now(), 'x')`,
        );
      });
      for (const [id, to, ended] of [
        [SESSION_B, 'active', 'null'],
        [SESSION_B, 'abandoned', 'ended_at'],
        ['b0000000-0000-4000-8000-0000000000e1', 'active', 'null'],
        ['b0000000-0000-4000-8000-0000000000e1', 'finished', 'ended_at'],
      ]) {
        await expect(
          committed(USER_B, (c) =>
            c.query(
              `update ${s}.practice_sessions set status = '${to}', ended_at = ${ended} where id = '${id}'`,
            ),
          ),
          `${id} -> ${to}`,
        ).rejects.toThrow(/status .* is final/);
      }
      // Re-saving the same final status is not a transition.
      await committed(USER_B, (c) =>
        c.query(`update ${s}.practice_sessions set status = 'finished' where id = '${SESSION_B}'`),
      );
    });

    it('stores the prompt without the job description and says so in the schema', async () => {
      await withClient(TEST_SUPERUSER_URL!, async (c) => {
        const { rows } = await c.query(
          `select col_description('${s}.practice_sessions'::regclass, a.attnum) as d
             from pg_attribute a
            where a.attrelid = '${s}.practice_sessions'::regclass and a.attname = 'prompt_used'`,
        );
        expect(rows[0].d).toContain('WITHOUT the job description');
        expect(rows[0].d).toContain('practice_contexts');
      });
    });

    it('removes sessions, messages, feedback, usage and cache when the account row is removed (owner/admin path)', async () => {
      await withClient(TEST_SUPERUSER_URL!, async (c) => {
        await c.query(`set role owner_${s}`);
        await c.query(`delete from ${s}.app_users where id = '${USER_A}'`);
        for (const table of [
          'practice_contexts',
          'practice_sessions',
          'practice_messages',
          'practice_feedback',
          'ai_usage_daily',
          'ai_cache',
        ]) {
          const { rows } = await c.query(
            `select count(*)::int as n from ${s}.${table} where user_id = $1`,
            [USER_A],
          );
          expect(rows[0].n, table).toBe(0);
        }
        const { rows } = await c.query(
          `select count(*)::int as n from ${s}.practice_sessions where user_id = $1`,
          [USER_B],
        );
        expect(rows[0].n).toBeGreaterThan(0);
      });
    });
  });
}
