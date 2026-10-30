import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate, setPasswords } from '../src/index';
import type { Environment } from '../src/index';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const TEST_SUPERUSER_URL = process.env.TEST_SUPERUSER_URL;

/** True when the real-Postgres tests can run. */
export const dbAvailable = Boolean(TEST_DATABASE_URL && TEST_SUPERUSER_URL);

if (!dbAvailable) {
  if (process.env.CI) {
    throw new Error(
      'TEST_DATABASE_URL and TEST_SUPERUSER_URL must be set in CI: the database tests must not be skipped.',
    );
  }
  console.warn(
    '\n*** WARNING: TEST_DATABASE_URL / TEST_SUPERUSER_URL are not set: the real-Postgres tests are SKIPPED. ***\n' +
      '*** Start the throwaway cluster: packages/db/scripts/test-postgres.sh start, then eval its `env` output. ***\n',
  );
}

export const CLI_PATH = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
export const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

export const ENVS: Environment[] = ['prod', 'rnd'];

/** The same server as `base`, logging in as another role. */
export function urlFor(base: string, user: string, password?: string): string {
  const url = new URL(base);
  url.username = user;
  url.password = password ?? '';
  return url.toString();
}

export async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

/** Runs `work` on a fresh connection and always closes it. */
export async function withClient<T>(
  url: string,
  work: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = await connect(url);
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** Superuser reset between tests: removes both environments and all their roles. */
export async function resetEnvironments(): Promise<void> {
  await withClient(TEST_SUPERUSER_URL!, async (client) => {
    await client.query('drop schema if exists prod cascade');
    await client.query('drop schema if exists rnd cascade');
    await client.query(`
      do $$
      declare r text;
      begin
        -- First release every privilege and membership, then drop the roles.
        foreach r in array array[
          'app_prod', 'app_prod_user', 'backup_prod', 'owner_prod',
          'app_rnd', 'app_rnd_user', 'backup_rnd', 'owner_rnd'
        ] loop
          if exists (select from pg_roles where rolname = r) then
            execute format('drop owned by %I', r);
          end if;
        end loop;
        foreach r in array array[
          'app_prod', 'app_prod_user', 'backup_prod', 'owner_prod',
          'app_rnd', 'app_rnd_user', 'backup_rnd', 'owner_rnd'
        ] loop
          if exists (select from pg_roles where rolname = r) then
            execute format('drop role %I', r);
          end if;
        end loop;
      end
      $$`);
  });
}

export interface TestEnvironments {
  /** Random passwords of app_<schema> and backup_<schema>, generated for this run only. */
  passwords: Record<Environment, { app: string; backup: string }>;
  appUrl(schema: Environment): string;
  backupUrl(schema: Environment): string;
}

/** Resets the database, migrates both environments as `migrator` and sets random passwords. */
export async function prepareEnvironments(): Promise<TestEnvironments> {
  await resetEnvironments();
  const passwords = {} as TestEnvironments['passwords'];
  for (const schema of ENVS) {
    await migrate({ schema, connectionString: TEST_DATABASE_URL! });
    passwords[schema] = {
      app: randomBytes(18).toString('hex'),
      backup: randomBytes(18).toString('hex'),
    };
    await setPasswords({
      schema,
      connectionString: TEST_DATABASE_URL!,
      appPassword: passwords[schema].app,
      backupPassword: passwords[schema].backup,
    });
  }
  return {
    passwords,
    appUrl: (schema) => urlFor(TEST_DATABASE_URL!, `app_${schema}`, passwords[schema].app),
    backupUrl: (schema) => urlFor(TEST_DATABASE_URL!, `backup_${schema}`, passwords[schema].backup),
  };
}

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the real CLI in a child process with exactly the given environment variables. */
export function runCli(args: string[], env: Record<string, string> = {}): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', CLI_PATH, ...args], {
      cwd: PACKAGE_DIR,
      env: { PATH: process.env.PATH ?? '', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/**
 * Runs `work` in a transaction as the backend does: `SET LOCAL ROLE app_<schema>_user` plus the
 * user's claims. `sub` null means no claims at all. Always rolled back.
 */
export async function asUser<T>(
  client: pg.Client,
  schema: Environment,
  sub: string | null,
  work: () => Promise<T>,
): Promise<T> {
  await client.query('begin');
  try {
    await client.query(`set local role app_${schema}_user`);
    if (sub !== null) {
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub }),
      ]);
    }
    return await work();
  } finally {
    await client.query('rollback');
  }
}
