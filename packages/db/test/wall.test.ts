import { beforeAll, describe, expect, it } from 'vitest';
import type { Environment } from '../src/index';
import {
  ENVS,
  TEST_SUPERUSER_URL,
  dbAvailable,
  prepareEnvironments,
  withClient,
  type TestEnvironments,
} from './helpers';

const other = (schema: Environment): Environment => (schema === 'prod' ? 'rnd' : 'prod');

describe.skipIf(!dbAvailable)('the wall between prod and rnd', () => {
  let env: TestEnvironments;

  beforeAll(async () => {
    env = await prepareEnvironments();
  });

  describe.each(ENVS)('the %s login roles', (schema) => {
    const foreign = other(schema);

    it(`app_${schema} cannot use the ${foreign} schema, switch to its roles or create in either`, async () => {
      await withClient(env.appUrl(schema), async (client) => {
        await expect(client.query(`select * from ${foreign}.environment_info`)).rejects.toThrow(
          new RegExp(`permission denied for schema ${foreign}`),
        );
        await expect(client.query(`select * from ${foreign}.schema_migrations`)).rejects.toThrow(
          new RegExp(`permission denied for schema ${foreign}`),
        );
        await expect(client.query(`set role app_${foreign}_user`)).rejects.toThrow(
          /permission denied to set role/,
        );
        await expect(client.query(`set role owner_${foreign}`)).rejects.toThrow(
          /permission denied to set role/,
        );
        await expect(client.query(`set role owner_${schema}`)).rejects.toThrow(
          /permission denied to set role/,
        );
        await expect(client.query(`create table ${schema}.x (id int)`)).rejects.toThrow(
          new RegExp(`permission denied for schema ${schema}`),
        );
        await expect(client.query(`create table ${foreign}.x (id int)`)).rejects.toThrow(
          new RegExp(`permission denied for schema ${foreign}`),
        );
        await expect(client.query('create table public.x (id int)')).rejects.toThrow(
          /permission denied/,
        );
      });
    });

    it(`app_${schema}_user cannot reach ${foreign} even after switching role`, async () => {
      await withClient(env.appUrl(schema), async (client) => {
        await client.query('begin');
        await client.query(`set local role app_${schema}_user`);
        // Positive control: its own environment works.
        const own = await client.query(`select name from ${schema}.environment_info`);
        expect(own.rows).toEqual([{ name: schema }]);
        await expect(client.query(`select * from ${foreign}.environment_info`)).rejects.toThrow(
          new RegExp(`permission denied for schema ${foreign}`),
        );
        await client.query('rollback');
      });
    });

    it(`backup_${schema} cannot reach ${foreign} and cannot write to ${schema}`, async () => {
      await withClient(env.backupUrl(schema), async (client) => {
        const own = await client.query(`select name from ${schema}.environment_info`);
        expect(own.rows).toEqual([{ name: schema }]);
        await expect(client.query(`select * from ${foreign}.environment_info`)).rejects.toThrow(
          new RegExp(`permission denied for schema ${foreign}`),
        );
        await expect(client.query(`set role app_${foreign}_user`)).rejects.toThrow(
          /permission denied to set role/,
        );
        await expect(client.query(`set role app_${schema}_user`)).rejects.toThrow(
          /permission denied to set role/,
        );
        await expect(client.query(`delete from ${schema}.environment_info`)).rejects.toThrow(
          /permission denied/,
        );
        await expect(client.query(`create table ${schema}.x (id int)`)).rejects.toThrow(
          /permission denied/,
        );
      });
    });
  });

  it('has no role membership and no PUBLIC grant across the wall', async () => {
    await withClient(TEST_SUPERUSER_URL!, async (client) => {
      for (const schema of ENVS) {
        const foreign = other(schema);
        for (const role of ['app', 'backup'] as const) {
          for (const target of [
            `owner_${foreign}`,
            `app_${foreign}`,
            `app_${foreign}_user`,
            `backup_${foreign}`,
          ]) {
            const { rows } = await client.query(
              `select pg_has_role($1, $2, 'member') as member, pg_has_role($1, $2, 'set') as can_set`,
              [`${role}_${schema}`, target],
            );
            expect(rows[0], `${role}_${schema} -> ${target}`).toEqual({
              member: false,
              can_set: false,
            });
          }
          const { rows } = await client.query(`select has_schema_privilege($1, $2, 'usage') as u`, [
            `${role}_${schema}`,
            foreign,
          ]);
          expect(rows[0].u).toBe(false);
        }
        // No ACL entry for PUBLIC (grantee 0) on the schema, and none for the other
        // environment's roles.
        const { rows: acl } = await client.query<{ grantee: string }>(
          `select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee
             from pg_namespace n, aclexplode(n.nspacl) a where n.nspname = $1 order by 1`,
          [schema],
        );
        expect(acl.map((row) => row.grantee)).toEqual([
          `app_${schema}`,
          `app_${schema}_user`,
          `backup_${schema}`,
          `owner_${schema}`,
          `owner_${schema}`,
        ]);
      }
    });
  });
});
