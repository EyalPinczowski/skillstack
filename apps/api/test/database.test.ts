import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, schemaForAppEnv, type Database } from '../src/db/database';
import { dbAvailable, prepareDatabase, type TestDb } from './db-helpers';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('schemaForAppEnv', () => {
  it('maps the two environments and nothing else', () => {
    expect(schemaForAppEnv('operational')).toBe('prod');
    expect(schemaForAppEnv('rnd')).toBe('rnd');
    for (const bad of ['prod', 'public', 'rnd; drop schema prod', '', 'RND']) {
      expect(() => schemaForAppEnv(bad)).toThrow();
    }
  });
});

describe.skipIf(!dbAvailable)('withUser (real Postgres)', () => {
  let testDb: TestDb;
  let db: Database;

  beforeAll(async () => {
    testDb = await prepareDatabase();
    await testDb.admin(async (c) => {
      await c.query(
        `insert into rnd.allowed_emails (email) values ('a@example.com'), ('b@example.com')`,
      );
      await c.query(
        `insert into rnd.app_users (id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')`,
        [A, B],
      );
    });
    db = createDatabase({ connectionString: testDb.appUrl('rnd'), appEnv: 'rnd' });
  });

  afterAll(async () => {
    await db?.close();
  });

  it('shows a user only their own row', async () => {
    const rows = await db.withUser(A, ({ client, schema }) =>
      client.query(`select id from ${schema}.app_users`),
    );
    expect(rows.rows).toEqual([{ id: A }]);
  });

  it('returns nothing for a query that runs without withUser (no claims, no role switch)', async () => {
    const pool = new pg.Pool({ connectionString: testDb.appUrl('rnd') });
    try {
      // The login role alone has no table privilege at all: reading is refused, not just empty.
      await expect(pool.query('select id from rnd.app_users')).rejects.toThrow(
        /permission denied for table app_users/,
      );
      // With the role but without claims, row-level security hides every row.
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query('set local role app_rnd_user');
        const none = await client.query('select id from rnd.app_users');
        expect(none.rows).toEqual([]);
        await client.query('rollback');
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  });

  it('does not leak the role or the claims to the next use of the same connection', async () => {
    const single = createDatabase({
      connectionString: testDb.appUrl('rnd'),
      appEnv: 'rnd',
      max: 1,
    });
    try {
      await single.withUser(A, async () => undefined);
      const after = await single.withUser(B, ({ client }) =>
        client.query(`select current_setting('request.jwt.claims', true) as claims`),
      );
      expect(JSON.parse(after.rows[0].claims)).toEqual({ sub: B });
      // A failed callback rolls back and the connection is reusable.
      await expect(
        single.withUser(A, async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      const again = await single.withUser(A, ({ client, schema }) =>
        client.query(`select id from ${schema}.app_users`),
      );
      expect(again.rows).toEqual([{ id: A }]);
    } finally {
      await single.close();
    }
  });

  it('rolls back everything when the callback fails', async () => {
    await expect(
      db.withUser(A, async ({ client, schema }) => {
        await client.query(`update ${schema}.app_users set display_name = 'temp' where id = $1`, [
          A,
        ]);
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    const rows = await db.withUser(A, ({ client, schema }) =>
      client.query(`select display_name from ${schema}.app_users`),
    );
    expect(rows.rows).toEqual([{ display_name: null }]);
  });

  it('refuses an id that is not a UUID before touching the database', async () => {
    await expect(db.withUser("x'; drop schema rnd; --", async () => 1)).rejects.toThrow(/UUID/);
    await expect(db.withUser('', async () => 1)).rejects.toThrow(/UUID/);
  });

  it('uses the prod schema and role for APP_ENV=operational', async () => {
    const prod = createDatabase({ connectionString: testDb.appUrl('prod'), appEnv: 'operational' });
    try {
      expect(prod.schema).toBe('prod');
      const rows = await prod.withUser(A, ({ client, schema }) =>
        client.query(`select id from ${schema}.app_users`),
      );
      expect(rows.rows).toEqual([]);
      // The environments are walled: the prod login cannot read the rnd schema.
      const wrong = createDatabase({ connectionString: testDb.appUrl('prod'), appEnv: 'rnd' });
      try {
        await expect(wrong.withUser(A, async () => 1)).rejects.toThrow(/permission denied|role/);
      } finally {
        await wrong.close();
      }
    } finally {
      await prod.close();
    }
  });
});
