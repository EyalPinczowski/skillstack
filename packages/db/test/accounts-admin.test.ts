import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { promoteAdmin } from '../src/index';
import {
  TEST_DATABASE_URL,
  TEST_SUPERUSER_URL,
  asUser,
  dbAvailable,
  prepareEnvironments,
  runCli,
  withClient,
  type TestEnvironments,
} from './helpers';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';

describe.skipIf(!dbAvailable)('allowlist, provision_user and promote-admin (rnd)', () => {
  let env: TestEnvironments;

  beforeAll(async () => {
    env = await prepareEnvironments();
  });

  /** Superuser reset of the rows these tests touch. */
  beforeEach(async () => {
    await withClient(TEST_SUPERUSER_URL!, async (c) => {
      await c.query('delete from rnd.app_users');
      await c.query('delete from rnd.allowed_emails');
      await c.query(`update rnd.app_settings set value = '25' where key = 'user_cap'`);
    });
  });

  const allow = (...emails: string[]) =>
    withClient(TEST_SUPERUSER_URL!, async (c) => {
      for (const e of emails)
        await c.query('insert into rnd.allowed_emails (email) values ($1)', [e]);
    });
  const provision = (id: string, email: string) =>
    withClient(env.appUrl('rnd'), (c) =>
      c.query('select * from rnd.provision_user($1, $2)', [id, email]),
    );

  it('creates a user with role user, lower-casing the email', async () => {
    await allow('a@example.com');
    const { rows } = await provision(U1, '  A@Example.com ');
    expect(rows[0]).toMatchObject({
      id: U1,
      email: 'a@example.com',
      role: 'user',
      status: 'active',
    });
  });

  it('is idempotent and returns the existing row', async () => {
    await allow('a@example.com');
    await provision(U1, 'a@example.com');
    const again = await provision(U1, 'a@example.com');
    expect(again.rows[0].id).toBe(U1);
    const { rows } = await withClient(TEST_SUPERUSER_URL!, (c) =>
      c.query('select count(*)::int as n from rnd.app_users'),
    );
    expect(rows[0].n).toBe(1);
  });

  it('refuses an email that is not on the allowlist', async () => {
    await expect(provision(U1, 'stranger@example.com')).rejects.toThrow(/not_allowed/);
  });

  it('refuses an email that belongs to another account', async () => {
    await allow('a@example.com');
    await provision(U1, 'a@example.com');
    await expect(provision(U2, 'a@example.com')).rejects.toThrow(/not_allowed|cap_reached/);
  });

  it('refuses when the number of active users has reached user_cap, but not existing users', async () => {
    await allow('a@example.com', 'b@example.com');
    await withClient(TEST_SUPERUSER_URL!, (c) =>
      c.query(`update rnd.app_settings set value = '1' where key = 'user_cap'`),
    );
    await provision(U1, 'a@example.com');
    await expect(provision(U2, 'b@example.com')).rejects.toThrow(/cap_reached/);
    await expect(provision(U1, 'a@example.com')).resolves.toBeDefined();
  });

  it('does not count disabled users against the cap', async () => {
    await allow('a@example.com', 'b@example.com');
    await withClient(TEST_SUPERUSER_URL!, (c) =>
      c.query(`update rnd.app_settings set value = '1' where key = 'user_cap'`),
    );
    await provision(U1, 'a@example.com');
    await withClient(TEST_SUPERUSER_URL!, (c) =>
      c.query(`update rnd.app_users set status = 'disabled'`),
    );
    await expect(provision(U2, 'b@example.com')).resolves.toBeDefined();
  });

  it('fails closed when user_cap is not a number', async () => {
    await allow('a@example.com');
    await withClient(TEST_SUPERUSER_URL!, (c) =>
      c.query(`update rnd.app_settings set value = '"many"' where key = 'user_cap'`),
    );
    await expect(provision(U1, 'a@example.com')).rejects.toThrow();
  });

  it('can be executed by the app login only: not PUBLIC, not the user role', async () => {
    await allow('a@example.com');
    await withClient(env.backupUrl('rnd'), async (c) => {
      await expect(
        c.query('select * from rnd.provision_user($1, $2)', [U1, 'a@example.com']),
      ).rejects.toThrow(/permission denied for function provision_user/);
    });
    await withClient(env.appUrl('rnd'), async (c) => {
      await expect(
        asUser(c, 'rnd', U1, () =>
          c.query('select * from rnd.provision_user($1, $2)', [U1, 'a@example.com']),
        ),
      ).rejects.toThrow(/permission denied for function provision_user/);
    });
    await withClient(TEST_SUPERUSER_URL!, async (c) => {
      const { rows } = await c.query(
        `select p.prosecdef, pg_get_userbyid(p.proowner) as owner, p.proconfig
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'rnd' and p.proname = 'provision_user'`,
      );
      expect(rows[0].prosecdef).toBe(true);
      expect(rows[0].owner).toBe('owner_rnd');
      expect(rows[0].proconfig.join()).toMatch(/search_path=rnd, pg_temp/);
    });
  });

  it('gives the app login and app users no access to allowed_emails', async () => {
    await allow('a@example.com');
    await withClient(env.appUrl('rnd'), async (c) => {
      await expect(c.query('select * from rnd.allowed_emails')).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        asUser(c, 'rnd', U1, () => c.query('select * from rnd.allowed_emails')),
      ).rejects.toThrow(/permission denied for table allowed_emails/);
      await expect(
        asUser(c, 'rnd', U1, () =>
          c.query(`insert into rnd.allowed_emails (email) values ('x@y.zz')`),
        ),
      ).rejects.toThrow(/permission denied/);
    });
    await withClient(env.backupUrl('rnd'), async (c) => {
      const { rows } = await c.query('select email from rnd.allowed_emails');
      expect(rows).toEqual([{ email: 'a@example.com' }]);
    });
  });

  it('rejects an email that is not stored lower-case', async () => {
    await expect(allow('Upper@Example.com')).rejects.toThrow(/check constraint/);
  });

  describe('promote-admin', () => {
    const opts = (email: string) => ({
      schema: 'rnd',
      connectionString: TEST_DATABASE_URL!,
      email,
    });

    it('adds the email and, once the account exists, sets the role to admin', async () => {
      const first = await promoteAdmin(opts('Boss@Example.com'));
      expect(first).toEqual({ email: 'boss@example.com', addedToAllowlist: true, promoted: false });
      await provision(U3, 'boss@example.com');
      const second = await promoteAdmin(opts('boss@example.com'));
      expect(second).toEqual({
        email: 'boss@example.com',
        addedToAllowlist: false,
        promoted: true,
      });
      const { rows } = await withClient(TEST_SUPERUSER_URL!, (c) =>
        c.query('select role from rnd.app_users where id = $1', [U3]),
      );
      expect(rows[0].role).toBe('admin');
    });

    it('is the only path: the app cannot change role', async () => {
      await allow('a@example.com');
      await provision(U1, 'a@example.com');
      await withClient(env.appUrl('rnd'), async (c) => {
        await expect(
          asUser(c, 'rnd', U1, () => c.query(`update rnd.app_users set role = 'admin'`)),
        ).rejects.toThrow(/permission denied/);
      });
    });

    it('works through the CLI and refuses without --schema or --email', async () => {
      const ok = await runCli(['promote-admin', '--schema', 'rnd', '--email', 'cli@example.com'], {
        DATABASE_URL: TEST_DATABASE_URL!,
      });
      expect(ok.code).toBe(0);
      expect(ok.stdout).toMatch(/added to the allowlist of rnd/);
      const noSchema = await runCli(['promote-admin', '--email', 'cli@example.com'], {
        DATABASE_URL: TEST_DATABASE_URL!,
      });
      expect(noSchema.code).toBe(2);
      expect(noSchema.stderr).toMatch(/Missing --schema/);
      const noEmail = await runCli(['promote-admin', '--schema', 'rnd'], {
        DATABASE_URL: TEST_DATABASE_URL!,
      });
      expect(noEmail.code).toBe(2);
      expect(noEmail.stderr).toMatch(/Missing --email/);
      const bad = await runCli(['promote-admin', '--schema', 'rnd', '--email', 'not-an-email'], {
        DATABASE_URL: TEST_DATABASE_URL!,
      });
      expect(bad.code).toBe(2);
    });
  });
});
