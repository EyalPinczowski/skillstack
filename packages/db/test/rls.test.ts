import { beforeAll, describe, expect, it } from 'vitest';
import {
  TEST_DATABASE_URL,
  asUser,
  dbAvailable,
  prepareEnvironments,
  withClient,
  type TestEnvironments,
} from './helpers';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

describe.skipIf(!dbAvailable)('row-level security model (rnd)', () => {
  let env: TestEnvironments;

  beforeAll(async () => {
    env = await prepareEnvironments();
    // What a later migration would do: create a user-owned table as the owner role.
    await withClient(TEST_DATABASE_URL!, async (client) => {
      await client.query('begin');
      await client.query('set local role owner_rnd');
      await client.query(`
        create table rnd.notes (
          id uuid primary key default gen_random_uuid(),
          user_id uuid not null,
          body text not null
        );
        alter table rnd.notes enable row level security;
        create policy notes_own on rnd.notes
          for all to app_rnd_user
          using (user_id = rnd.current_user_id()) with check (user_id = rnd.current_user_id());
        create policy backup_select on rnd.notes for select to backup_rnd using (true);
        insert into rnd.notes (user_id, body) values
          ('${USER_A}', 'a1'), ('${USER_A}', 'a2'), ('${USER_B}', 'b1');
      `);
      await client.query('commit');
    });
  });

  it('shows each user only their own rows', async () => {
    await withClient(env.appUrl('rnd'), async (client) => {
      const a = await asUser(client, 'rnd', USER_A, () =>
        client.query('select body from rnd.notes order by body'),
      );
      expect(a.rows).toEqual([{ body: 'a1' }, { body: 'a2' }]);
      const b = await asUser(client, 'rnd', USER_B, () =>
        client.query('select body from rnd.notes order by body'),
      );
      expect(b.rows).toEqual([{ body: 'b1' }]);
    });
  });

  it('returns zero rows when there are no claims', async () => {
    await withClient(env.appUrl('rnd'), async (client) => {
      const none = await asUser(client, 'rnd', null, () => client.query('select * from rnd.notes'));
      expect(none.rows).toEqual([]);
    });
  });

  it('refuses to insert a row for another user, and cannot touch or steal their rows', async () => {
    await withClient(env.appUrl('rnd'), async (client) => {
      await expect(
        asUser(client, 'rnd', USER_A, () =>
          client.query(`insert into rnd.notes (user_id, body) values ($1, 'forged')`, [USER_B]),
        ),
      ).rejects.toThrow(/row-level security policy/);

      const update = await asUser(client, 'rnd', USER_A, () =>
        client.query(`update rnd.notes set body = 'hacked' where user_id = $1`, [USER_B]),
      );
      expect(update.rowCount).toBe(0);
      const del = await asUser(client, 'rnd', USER_A, () =>
        client.query(`delete from rnd.notes where user_id = $1`, [USER_B]),
      );
      expect(del.rowCount).toBe(0);
      await expect(
        asUser(client, 'rnd', USER_A, () =>
          client.query(`update rnd.notes set user_id = $1 where body = 'a1'`, [USER_B]),
        ),
      ).rejects.toThrow(/row-level security policy/);

      // And the user can write their own row (the policy is not simply denying everything).
      const own = await asUser(client, 'rnd', USER_A, () =>
        client.query(`insert into rnd.notes (user_id, body) values ($1, 'mine')`, [USER_A]),
      );
      expect(own.rowCount).toBe(1);
    });
  });

  it('gives app_rnd nothing until it switches role (NOINHERIT)', async () => {
    await withClient(env.appUrl('rnd'), async (client) => {
      await expect(client.query('select * from rnd.notes')).rejects.toThrow(
        /permission denied for schema rnd/,
      );
      await expect(client.query('select * from rnd.environment_info')).rejects.toThrow(
        /permission denied for schema rnd/,
      );
    });
  });

  it('keeps the migration ledger away from app users', async () => {
    await withClient(env.appUrl('rnd'), async (client) => {
      await expect(
        asUser(client, 'rnd', USER_A, () => client.query('select * from rnd.schema_migrations')),
      ).rejects.toThrow(/permission denied for table schema_migrations/);
    });
  });

  it('lets the backup role read every row, but not change anything', async () => {
    await withClient(env.backupUrl('rnd'), async (client) => {
      const all = await client.query('select body from rnd.notes where body <> $1 order by body', [
        'mine',
      ]);
      expect(all.rows).toEqual([{ body: 'a1' }, { body: 'a2' }, { body: 'b1' }]);
      await expect(client.query(`update rnd.notes set body = 'x'`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(client.query(`delete from rnd.notes`)).rejects.toThrow(/permission denied/);
    });
  });

  it('lets users read the environment name', async () => {
    await withClient(env.appUrl('rnd'), async (client) => {
      const info = await asUser(client, 'rnd', USER_A, () =>
        client.query('select name from rnd.environment_info'),
      );
      expect(info.rows).toEqual([{ name: 'rnd' }]);
      await expect(
        asUser(client, 'rnd', USER_A, () =>
          client.query(`update rnd.environment_info set name = 'prod'`),
        ),
      ).resolves.toMatchObject({ rowCount: 0 });
    });
  });
});
