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
          'adjustments',
          'allowed_emails',
          'app_settings',
          'app_users',
          'day_overrides',
          'day_reviews',
          'day_sessions',
          'environment_info',
          'events',
          'legal_acceptances',
          'logs',
          'plans',
          'schedule_days',
          'schema_migrations',
          'tasks',
          'week_patterns',
        ]);
        for (const row of rows) {
          expect(row.relrowsecurity, `${row.relname} RLS`).toBe(true);
          expect(row.policies, `${row.relname} backup policy`).toBe(1);
        }
      });
    },
  );

  it.each(ENVS)(
    'has no views (they would read as their owner and skip RLS) and pins search_path on every SECURITY DEFINER function in %s',
    async (schema) => {
      await withClient(TEST_SUPERUSER_URL!, async (client) => {
        const views = await client.query<{ relname: string }>(
          `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = $1 and c.relkind in ('v', 'm', 'f')`,
          [schema],
        );
        expect(views.rows).toEqual([]);

        const { rows } = await client.query<{
          name: string;
          config: string[] | null;
          public_execute: boolean;
        }>(
          `select p.proname as name, p.proconfig as config,
                  has_function_privilege('public', p.oid, 'execute') as public_execute
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = $1 and p.prosecdef
            order by p.proname`,
          [schema],
        );
        // A new SECURITY DEFINER function must be reviewed and added here on purpose.
        expect(rows.map((r) => r.name)).toEqual(['delete_account', 'provision_user']);
        for (const row of rows) {
          expect(row.config ?? [], `${row.name} search_path`).toContain(
            `search_path=${schema}, pg_temp`,
          );
          expect(row.public_execute, `${row.name} PUBLIC execute`).toBe(false);
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
