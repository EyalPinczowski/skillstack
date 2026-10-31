import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  let a: pg.Client;
  let b: pg.Client;

  beforeAll(async () => {
    a = new pg.Client({ connectionString: TEST_SUPERUSER_URL });
    b = new pg.Client({ connectionString: TEST_SUPERUSER_URL });
    await a.connect();
    await b.connect();
  });

  afterAll(async () => {
    await a?.end();
    await b?.end();
  });

  const holdThenTry = async (first: 'prod' | 'rnd', second: 'prod' | 'rnd') => {
    await a.query('begin');
    await b.query('begin');
    try {
      await lockPlanDays({ client: a, schema: first }, USER, PLAN);
      await b.query(`set local lock_timeout = '300ms'`);
      return await lockPlanDays({ client: b, schema: second }, USER, PLAN).then(
        () => 'acquired',
        (error: { code?: string }) => error.code,
      );
    } finally {
      await b.query('rollback');
      await a.query('rollback');
    }
  };

  it('does not make one environment wait for the other', async () => {
    expect(await holdThenTry('prod', 'rnd')).toBe('acquired');
  });

  it('still serialises the same plan within one environment', async () => {
    // 55P03 = lock_not_available (lock_timeout).
    expect(await holdThenTry('rnd', 'rnd')).toBe('55P03');
  });
});
