import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { lockPlanDays } from '../src/modules/days/repository';
import { dbAvailable, TEST_SUPERUSER_URL } from './db-helpers';

const USER = '11111111-1111-4111-8111-111111111111';
const PLAN = 'a0000000-0000-4000-8000-000000000001';

/**
 * The day-state lock is a database-wide advisory lock. Both environments live in one database
 * and share one Supabase Auth (ADR 003), so the same user id and client plan id can exist in
 * `prod` and `rnd`. Their locks must not wait for each other (v0.2 review).
 */
describe.skipIf(!dbAvailable)('lockPlanDays (real Postgres)', () => {
  // Fresh connections per test: a failed step in one test cannot leave a transaction or a lock
  // behind for the next one.
  const holdThenTry = async (first: 'prod' | 'rnd', second: 'prod' | 'rnd') => {
    const a = new pg.Client({ connectionString: TEST_SUPERUSER_URL });
    const b = new pg.Client({ connectionString: TEST_SUPERUSER_URL });
    await a.connect();
    await b.connect();
    try {
      await a.query('begin');
      await b.query('begin');
      await lockPlanDays({ client: a, schema: first }, USER, PLAN);
      // Set before the contested attempt, so a failure to acquire is a timeout, not a hang.
      await b.query(`set local lock_timeout = '300ms'`);
      return await lockPlanDays({ client: b, schema: second }, USER, PLAN).then(
        () => 'acquired' as const,
        (error: unknown) => {
          const code = (error as { code?: string } | null)?.code;
          // 55P03 = lock_not_available (lock_timeout). Anything else is a different failure.
          if (code !== '55P03') {
            throw new Error(
              `expected lock_timeout (55P03) or success, got ${String(code)}: ${String(error)}`,
              { cause: error },
            );
          }
          return 'timeout' as const;
        },
      );
    } finally {
      await b.query('rollback').catch(() => undefined);
      await a.query('rollback').catch(() => undefined);
      await a.end().catch(() => undefined);
      await b.end().catch(() => undefined);
    }
  };

  it('does not make one environment wait for the other', async () => {
    expect(await holdThenTry('prod', 'rnd'), 'prod and rnd must not block each other').toBe(
      'acquired',
    );
  });

  it('still serialises the same plan within one environment', async () => {
    expect(await holdThenTry('rnd', 'rnd'), 'the same plan in one schema must wait').toBe(
      'timeout',
    );
  });
});
