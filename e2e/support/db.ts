import { randomBytes } from 'node:crypto';
import { environmentNames, migrate, setPasswords } from '@skillstack/db';
import pg from 'pg';

/**
 * Throwaway database for the e2e run: the `rnd` schema is dropped, migrated with the real
 * migrations and given random passwords. TEST INFRASTRUCTURE: it refuses anything that is not a
 * loopback database, because it DROPS the schema first.
 */
const SCHEMA = 'rnd' as const;

function assertLoopback(name: string, connectionString: string): void {
  const host = new URL(connectionString).hostname;
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw new Error(`${name} must point at a local throwaway database (got host "${host}").`);
  }
}

export async function withClient<T>(url: string, work: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

function withLogin(base: string, user: string, password: string): string {
  const url = new URL(base);
  url.username = user;
  url.password = password;
  return url.toString();
}

/** Returns the DATABASE_URL of the API (the app_rnd login with a fresh random password). */
export async function prepareDatabase(adminUrl: string, superuserUrl: string): Promise<string> {
  assertLoopback('TEST_DATABASE_URL', adminUrl);
  assertLoopback('TEST_SUPERUSER_URL', superuserUrl);
  const names = environmentNames(SCHEMA);
  const roles = [names.app, names.appUser, names.backup, names.owner];

  await withClient(superuserUrl, async (client) => {
    await client.query(`drop schema if exists ${SCHEMA} cascade`);
    for (const role of roles) {
      const { rows } = await client.query('select from pg_roles where rolname = $1', [role]);
      if (rows.length > 0) await client.query(`drop owned by ${role}`);
    }
    for (const role of roles) {
      const { rows } = await client.query('select from pg_roles where rolname = $1', [role]);
      if (rows.length > 0) await client.query(`drop role ${role}`);
    }
  });

  await migrate({ schema: SCHEMA, connectionString: adminUrl });
  // Generated now, held in memory and in the API's environment only. Never written to disk.
  const appPassword = randomBytes(18).toString('hex');
  await setPasswords({
    schema: SCHEMA,
    connectionString: adminUrl,
    appPassword,
    backupPassword: randomBytes(18).toString('hex'),
  });
  return withLogin(adminUrl, names.app, appPassword);
}

/** Puts the email on the sign-in allowlist (what promote-admin does for a new person). */
export async function allowEmail(superuserUrl: string, email: string): Promise<void> {
  await withClient(superuserUrl, (client) =>
    client.query(
      `insert into ${SCHEMA}.allowed_emails (email, added_by) values ($1, 'e2e') on conflict do nothing`,
      [email.toLowerCase()],
    ),
  );
}
