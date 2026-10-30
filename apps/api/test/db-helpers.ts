import { randomBytes } from 'node:crypto';
import { migrate, setPasswords } from '@skillstack/db';
import pg from 'pg';

/**
 * Real-Postgres test setup, a small duplicate of packages/db/test/helpers.ts (that file is not
 * exported from the package). Same variables, same throwaway cluster:
 *   packages/db/scripts/test-postgres.sh start && eval "$(packages/db/scripts/test-postgres.sh env)"
 * Test infrastructure only. Never point these at a real database.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const TEST_SUPERUSER_URL = process.env.TEST_SUPERUSER_URL;
export const dbAvailable = Boolean(TEST_DATABASE_URL && TEST_SUPERUSER_URL);

if (!dbAvailable) {
  if (process.env.CI) {
    throw new Error(
      'TEST_DATABASE_URL and TEST_SUPERUSER_URL must be set in CI: the database tests must not be skipped.',
    );
  }
  console.warn(
    '\n*** WARNING: TEST_DATABASE_URL / TEST_SUPERUSER_URL are not set: the real-Postgres API tests are SKIPPED. ***\n' +
      '*** Start the throwaway cluster: packages/db/scripts/test-postgres.sh start, then eval its `env` output. ***\n',
  );
}

export type Schema = 'prod' | 'rnd';

export function urlFor(base: string, user: string, password: string): string {
  const url = new URL(base);
  url.username = user;
  url.password = password;
  return url.toString();
}

export async function withClient<T>(
  url: string,
  work: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

const ROLES = ['app', 'app_user', 'backup', 'owner'] as const;
const roleNames = (schema: Schema) =>
  ROLES.map((r) => (r === 'app_user' ? `app_${schema}_user` : `${r}_${schema}`));

async function reset(): Promise<void> {
  await withClient(TEST_SUPERUSER_URL!, async (client) => {
    for (const schema of ['prod', 'rnd'] as const) {
      await client.query(`drop schema if exists ${schema} cascade`);
    }
    for (const schema of ['prod', 'rnd'] as const) {
      for (const role of roleNames(schema)) {
        const { rows } = await client.query('select from pg_roles where rolname = $1', [role]);
        if (rows.length > 0) await client.query(`drop owned by ${role}`);
      }
    }
    for (const schema of ['prod', 'rnd'] as const) {
      for (const role of roleNames(schema)) {
        const { rows } = await client.query('select from pg_roles where rolname = $1', [role]);
        if (rows.length > 0) await client.query(`drop role ${role}`);
      }
    }
  });
}

export interface TestDb {
  /** Connection string of the app_<schema> login, as the API gets it in DATABASE_URL. */
  appUrl(schema: Schema): string;
  /** Superuser fixture access (inserting allowlist rows, reading raw tables). */
  admin<T>(work: (client: pg.Client) => Promise<T>): Promise<T>;
}

/** Drops both environments, migrates them with the real migrations and sets random passwords. */
export async function prepareDatabase(): Promise<TestDb> {
  await reset();
  const passwords = {} as Record<Schema, string>;
  for (const schema of ['prod', 'rnd'] as const) {
    await migrate({ schema, connectionString: TEST_DATABASE_URL! });
    passwords[schema] = randomBytes(18).toString('hex');
    await setPasswords({
      schema,
      connectionString: TEST_DATABASE_URL!,
      appPassword: passwords[schema],
      backupPassword: randomBytes(18).toString('hex'),
    });
  }
  return {
    appUrl: (schema) => urlFor(TEST_DATABASE_URL!, `app_${schema}`, passwords[schema]),
    admin: (work) => withClient(TEST_SUPERUSER_URL!, work),
  };
}
