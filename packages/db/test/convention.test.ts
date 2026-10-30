import { beforeAll, describe, expect, it } from 'vitest';
import { findConventionViolations } from '../src/index';
import {
  ENVS,
  TEST_DATABASE_URL,
  TEST_SUPERUSER_URL,
  dbAvailable,
  prepareEnvironments,
  withClient,
} from './helpers';

describe.skipIf(!dbAvailable)('table convention: RLS enabled and a backup SELECT policy', () => {
  beforeAll(async () => {
    await prepareEnvironments();
  });

  it.each(ENVS)(
    'every table in %s has RLS enabled and a SELECT policy for its backup role',
    async (schema) => {
      const violations = await withClient(TEST_SUPERUSER_URL!, (client) =>
        findConventionViolations(client, schema),
      );
      expect(violations).toEqual([]);

      // Independent of the helper: the same facts straight from the catalogs.
      await withClient(TEST_SUPERUSER_URL!, async (client) => {
        const { rows } = await client.query<{
          relname: string;
          relrowsecurity: boolean;
          policies: number;
        }>(
          `select c.relname, c.relrowsecurity,
                (select count(*)::int from pg_policy p
                  where p.polrelid = c.oid and p.polcmd = 'r'
                    and p.polroles = array[('backup_' || $1)::regrole::oid]) as policies
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = $1 and c.relkind = 'r'`,
          [schema],
        );
        expect(rows.map((r) => r.relname).sort()).toEqual([
          'environment_info',
          'schema_migrations',
        ]);
        for (const row of rows) {
          expect(row.relrowsecurity, `${row.relname} RLS`).toBe(true);
          expect(row.policies, `${row.relname} backup policy`).toBe(1);
        }
      });
    },
  );

  it('the helper reports tables that break the convention', async () => {
    await withClient(TEST_DATABASE_URL!, async (client) => {
      await client.query('begin');
      try {
        await client.query('set local role owner_rnd');
        await client.query('create table rnd.no_rls (id int)');
        await client.query('create table rnd.no_policy (id int)');
        await client.query('alter table rnd.no_policy enable row level security');
        const violations = await findConventionViolations(client, 'rnd');
        expect(violations).toEqual([
          'rnd.no_policy: no SELECT policy for backup_rnd',
          'rnd.no_rls: row-level security is not enabled',
          'rnd.no_rls: no SELECT policy for backup_rnd',
        ]);
      } finally {
        await client.query('rollback');
      }
    });
  });
});
