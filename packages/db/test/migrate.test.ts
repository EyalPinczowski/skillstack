import { readdirSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate, environmentNames } from '../src/index';
import type { Environment } from '../src/index';
import {
  ENVS,
  TEST_DATABASE_URL,
  TEST_SUPERUSER_URL,
  dbAvailable,
  resetEnvironments,
  withClient,
} from './helpers';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));
const FIRST = '0001_environment_info.sql';
/** Every real migration file, in order. */
const REAL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort();

interface RoleRow {
  rolname: string;
  rolsuper: boolean;
  rolinherit: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolcanlogin: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
}

async function roles(names: string[]): Promise<Map<string, RoleRow>> {
  return withClient(TEST_SUPERUSER_URL!, async (client) => {
    const { rows } = await client.query<RoleRow>(
      `select rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin,
              rolreplication, rolbypassrls
         from pg_roles where rolname = any ($1)`,
      [names],
    );
    return new Map(rows.map((row) => [row.rolname, row]));
  });
}

const tempDirs: string[] = [];
async function copyOfMigrations(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'skillstack-migrations-'));
  tempDirs.push(dir);
  await cp(MIGRATIONS, dir, { recursive: true });
  return dir;
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe.skipIf(!dbAvailable)('migrate (real Postgres, non-superuser admin)', () => {
  beforeEach(resetEnvironments);

  it('creates both environments as a non-superuser with the exact role attributes', async () => {
    // The admin must really be a non-superuser, otherwise this proves nothing about portability.
    const admin = await withClient(TEST_DATABASE_URL!, async (client) => {
      const { rows } = await client.query<{ rolsuper: boolean }>(
        'select rolsuper from pg_roles where rolname = current_user',
      );
      return rows[0];
    });
    expect(admin?.rolsuper).toBe(false);

    for (const schema of ENVS) {
      const result = await migrate({ schema, connectionString: TEST_DATABASE_URL! });
      expect(result).toEqual({ applied: REAL, skipped: [] });
    }

    for (const schema of ENVS) {
      const n = environmentNames(schema);
      const found = await roles([n.owner, n.app, n.appUser, n.backup]);
      const common = {
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
        rolbypassrls: false,
        rolinherit: false,
      };
      expect(found.get(n.owner)).toMatchObject({ ...common, rolcanlogin: false });
      expect(found.get(n.appUser)).toMatchObject({ ...common, rolcanlogin: false });
      expect(found.get(n.app)).toMatchObject({ ...common, rolcanlogin: true });
      expect(found.get(n.backup)).toMatchObject({ ...common, rolcanlogin: true });
    }
  });

  it('keeps the two environments free of cross memberships and of BYPASSRLS', async () => {
    for (const schema of ENVS) await migrate({ schema, connectionString: TEST_DATABASE_URL! });
    await withClient(TEST_SUPERUSER_URL!, async (client) => {
      const { rows: memberships } = await client.query<{ member: string; role: string }>(
        `select m.rolname as member, r.rolname as role
           from pg_auth_members am
           join pg_roles m on m.oid = am.member
           join pg_roles r on r.oid = am.roleid
          where (m.rolname ~ '_(prod|rnd)(_user)?$' or r.rolname ~ '_(prod|rnd)(_user)?$')
            and m.rolname <> 'migrator'
          order by 1, 2`,
      );
      // The only membership between our roles: the login role may SET ROLE to the user role.
      expect(memberships).toEqual([
        { member: 'app_prod', role: 'app_prod_user' },
        { member: 'app_rnd', role: 'app_rnd_user' },
      ]);
      const { rows: bypass } = await client.query(
        `select rolname from pg_roles where rolbypassrls and rolname ~ '_(prod|rnd)(_user)?$'`,
      );
      expect(bypass).toEqual([]);
    });
  });

  it('makes the owner role own every object in the schema', async () => {
    for (const schema of ENVS) {
      await migrate({ schema, connectionString: TEST_DATABASE_URL! });
      const { owner } = environmentNames(schema);
      await withClient(TEST_SUPERUSER_URL!, async (client) => {
        const { rows: schemaOwner } = await client.query<{ owner: string }>(
          `select pg_get_userbyid(nspowner) as owner from pg_namespace where nspname = $1`,
          [schema],
        );
        expect(schemaOwner).toEqual([{ owner }]);
        const { rows: objects } = await client.query<{ relname: string; owner: string }>(
          `select c.relname, pg_get_userbyid(c.relowner) as owner
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = $1`,
          [schema],
        );
        // environment_info, schema_migrations and their indexes.
        expect(objects.length).toBeGreaterThanOrEqual(4);
        expect(objects.filter((o) => o.owner !== owner)).toEqual([]);
      });
    }
  });

  it('applies nothing the second time, and re-asserts repaired role attributes', async () => {
    await migrate({ schema: 'rnd', connectionString: TEST_DATABASE_URL! });
    // Tamper with a role as superuser, as someone might by hand.
    await withClient(TEST_SUPERUSER_URL!, (client) => client.query('alter role app_rnd inherit'));
    const again = await migrate({ schema: 'rnd', connectionString: TEST_DATABASE_URL! });
    expect(again).toEqual({ applied: [], skipped: REAL });
    expect((await roles(['app_rnd'])).get('app_rnd')?.rolinherit).toBe(false);
  });

  it('fails naming the file when an applied migration was changed', async () => {
    const dir = await copyOfMigrations();
    await migrate({ schema: 'rnd', connectionString: TEST_DATABASE_URL!, migrationsDir: dir });
    const file = join(dir, FIRST);
    await writeFile(file, `${await readFile(file, 'utf8')}\n-- edited later\n`);
    await expect(
      migrate({ schema: 'rnd', connectionString: TEST_DATABASE_URL!, migrationsDir: dir }),
    ).rejects.toThrow(new RegExp(`${FIRST}.*changed after it was applied`));
  });

  it('rolls a failing migration back and does not record it', async () => {
    const dir = await copyOfMigrations();
    await writeFile(
      join(dir, '9001_broken.sql'),
      'set local role {{owner}};\ncreate table {{schema}}.half_done (id int);\nselect 1 / 0;\n',
    );
    await expect(
      migrate({ schema: 'rnd', connectionString: TEST_DATABASE_URL!, migrationsDir: dir }),
    ).rejects.toThrow(/9001_broken\.sql failed/);
    await withClient(TEST_SUPERUSER_URL!, async (client) => {
      const { rows: table } = await client.query(`select to_regclass('rnd.half_done') as t`);
      expect(table[0].t).toBeNull();
      const { rows: ledger } = await client.query('select version from rnd.schema_migrations');
      expect(ledger).toEqual(REAL.map((f) => ({ version: f.slice(0, 4) })));
    });
  });

  it('--dry-run lists what would run and changes nothing', async () => {
    const dir = await copyOfMigrations();

    // On an empty database: nothing is created, not even the roles or the schema.
    const fresh = await migrate({
      schema: 'rnd',
      connectionString: TEST_DATABASE_URL!,
      migrationsDir: dir,
      dryRun: true,
    });
    expect(fresh).toEqual({ applied: REAL, skipped: [] });
    await withClient(TEST_SUPERUSER_URL!, async (client) => {
      const { rows } = await client.query(
        `select (select count(*) from pg_namespace where nspname = 'rnd') as schemas,
                (select count(*) from pg_roles where rolname like '%\\_rnd%') as roles`,
      );
      expect(rows[0]).toEqual({ schemas: '0', roles: '0' });
    });

    // After a real run, a new pending migration is listed but not applied.
    await migrate({ schema: 'rnd', connectionString: TEST_DATABASE_URL!, migrationsDir: dir });
    await writeFile(
      join(dir, '9002_more.sql'),
      'set local role {{owner}};\ncreate table {{schema}}.more (id int);\n',
    );
    const pending = await migrate({
      schema: 'rnd',
      connectionString: TEST_DATABASE_URL!,
      migrationsDir: dir,
      dryRun: true,
    });
    expect(pending).toEqual({ applied: ['9002_more.sql'], skipped: REAL });
    await withClient(TEST_SUPERUSER_URL!, async (client) => {
      const { rows } = await client.query(`select to_regclass('rnd.more') as t`);
      expect(rows[0].t).toBeNull();
    });
  });

  it.each<Environment>(ENVS)('serializes two concurrent runs on %s', async (schema) => {
    const results = await Promise.all([
      migrate({ schema, connectionString: TEST_DATABASE_URL! }),
      migrate({ schema, connectionString: TEST_DATABASE_URL! }),
    ]);
    // Exactly one run applied the migration; the other waited for the lock and skipped it.
    expect(results.flatMap((r) => r.applied)).toEqual(REAL);
    expect(results.flatMap((r) => r.skipped)).toEqual(REAL);
    await withClient(TEST_SUPERUSER_URL!, async (client) => {
      const { rows } = await client.query(
        `select count(*)::int as n from ${schema}.schema_migrations`,
      );
      expect(rows[0].n).toBe(REAL.length);
    });
  });

  it('rejects an invalid schema before it connects', async () => {
    for (const schema of ['public', '', 'PROD', 'rnd; drop schema prod']) {
      await expect(
        migrate({ schema, connectionString: 'postgres://nobody@127.0.0.1:1/none' }),
      ).rejects.toThrow(/Invalid schema/);
    }
  });

  it('lets the backup role read sequences of later tables (pg_dump needs SELECT on them)', async () => {
    const dir = await copyOfMigrations();
    await writeFile(
      join(dir, '9003_counted.sql'),
      [
        'set local role {{owner}};',
        'create table {{schema}}.counted (id bigint generated always as identity primary key);',
        'alter table {{schema}}.counted enable row level security;',
        'create policy backup_select on {{schema}}.counted for select to {{backup}} using (true);',
        '',
      ].join('\n'),
    );
    await migrate({ schema: 'rnd', connectionString: TEST_DATABASE_URL!, migrationsDir: dir });
    await withClient(TEST_SUPERUSER_URL!, async (client) => {
      const { rows } = await client.query(
        `select has_sequence_privilege('backup_rnd', 'rnd.counted_id_seq', 'SELECT') as backup,
                has_sequence_privilege('backup_rnd', 'rnd.counted_id_seq', 'UPDATE') as backup_write`,
      );
      expect(rows[0]).toEqual({ backup: true, backup_write: false });
    });
  });
});

describe('migration files', () => {
  it('refuses two files with the same version number before it connects', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skillstack-migrations-'));
    tempDirs.push(dir);
    await writeFile(join(dir, '0001_first.sql'), 'select 1;\n');
    await writeFile(join(dir, '0001_second.sql'), 'select 2;\n');
    // No connection string: without the duplicate check this would fail for another reason.
    await expect(migrate({ schema: 'rnd', migrationsDir: dir })).rejects.toThrow(
      /Duplicate migration version 0001: 0001_first\.sql and 0001_second\.sql/,
    );
  });
});
