import type { Client } from 'pg';
import { environmentNames, type Environment } from './names';

/**
 * Checks the table convention for one environment schema and returns one message per violation
 * (an empty array means all good): every table has row-level security enabled and a SELECT
 * policy for the backup role. Call it in the tests of every migration branch.
 */
export async function findConventionViolations(
  client: Pick<Client, 'query'>,
  schema: Environment,
): Promise<string[]> {
  const { backup } = environmentNames(schema);
  const { rows } = await client.query<{
    table_name: string;
    rls_enabled: boolean;
    has_backup_select: boolean;
  }>(
    `select c.relname as table_name,
            c.relrowsecurity as rls_enabled,
            exists (
              select from pg_policy p
              where p.polrelid = c.oid
                and p.polcmd in ('r', '*')
                and (select oid from pg_roles where rolname = $2) = any (p.polroles)
            ) as has_backup_select
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1
        and c.relkind in ('r', 'p')
      order by c.relname`,
    [schema, backup],
  );
  const violations: string[] = [];
  for (const row of rows) {
    if (!row.rls_enabled) {
      violations.push(`${schema}.${row.table_name}: row-level security is not enabled`);
    }
    if (!row.has_backup_select) {
      violations.push(`${schema}.${row.table_name}: no SELECT policy for ${backup}`);
    }
  }
  return violations;
}
