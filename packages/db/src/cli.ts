import { parseArgs } from 'node:util';
import { ENVIRONMENTS, InvalidSchemaError, parseEnvironment } from './names';
import { migrate, migrationStatus } from './migrate';
import { setPasswords } from './passwords';
import { InvalidEmailError, promoteAdmin } from './admin';

const USAGE = `Usage:
  migrate --schema <${ENVIRONMENTS.join('|')}> [--dry-run]
  status --schema <${ENVIRONMENTS.join('|')}>
  set-passwords --schema <${ENVIRONMENTS.join('|')}>
  promote-admin --schema <${ENVIRONMENTS.join('|')}> --email <address>
    (adds the email to the allowlist and makes an existing account admin)

Environment:
  DATABASE_URL     admin connection string (from a secret; never printed)
  APP_PASSWORD     set-passwords only: password of app_<schema>, at least 24 characters
  BACKUP_PASSWORD  set-passwords only: password of backup_<schema>, at least 24 characters
`;

/** Exit code for wrong usage (missing or invalid arguments or environment). */
const EXIT_USAGE = 2;

class UsageError extends Error {}

/** Removes the connection string, its password, any URL-looking text and given secrets. */
function redact(text: string, secrets: Array<string | undefined>): string {
  let result = text;
  for (const secret of secrets) {
    if (secret) result = result.split(secret).join('[redacted]');
  }
  return result.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[redacted-url]');
}

function passwordOf(connectionString: string | undefined): string | undefined {
  if (!connectionString) return undefined;
  try {
    const url = new URL(connectionString);
    return url.password ? decodeURIComponent(url.password) : undefined;
  } catch {
    return undefined;
  }
}

function requireSchema(value: string | undefined): ReturnType<typeof parseEnvironment> {
  if (value === undefined) throw new UsageError('Missing --schema. Refusing to run without one.');
  try {
    return parseEnvironment(value);
  } catch (error) {
    if (error instanceof InvalidSchemaError) throw new UsageError(error.message);
    throw error;
  }
}

async function run(argv: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h') {
    throw new UsageError(`Missing command.\n\n${USAGE}`);
  }
  if (!['migrate', 'status', 'set-passwords', 'promote-admin'].includes(command)) {
    throw new UsageError(`Unknown command.\n\n${USAGE}`);
  }

  let values: { schema?: string; 'dry-run'?: boolean; email?: string };
  try {
    ({ values } = parseArgs({
      args: rest,
      options: {
        schema: { type: 'string' },
        'dry-run': { type: 'boolean' },
        email: { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new UsageError(
      `${error instanceof Error ? error.message : 'Bad arguments.'}\n\n${USAGE}`,
    );
  }

  // The schema is checked before anything else, and before any connection is made.
  const schema = requireSchema(values.schema);
  if (values['dry-run'] && command !== 'migrate') {
    throw new UsageError('--dry-run only applies to the migrate command.');
  }

  if (values.email !== undefined && command !== 'promote-admin') {
    throw new UsageError('--email only applies to the promote-admin command.');
  }
  if (command === 'promote-admin' && values.email === undefined) {
    throw new UsageError('Missing --email.');
  }

  const connectionString = env.DATABASE_URL;
  if (!connectionString) throw new UsageError('DATABASE_URL is not set.');

  if (command === 'migrate') {
    const dryRun = values['dry-run'] === true;
    const result = await migrate({ schema, connectionString, dryRun });
    const verb = dryRun ? 'Would apply' : 'Applied';
    console.log(`${verb} ${result.applied.length} migration(s) on schema ${schema}.`);
    for (const file of result.applied) console.log(`  + ${file}`);
    for (const file of result.skipped) console.log(`  = ${file} (already applied)`);
    return;
  }

  if (command === 'status') {
    const result = await migrationStatus({ schema, connectionString });
    console.log(
      `Schema ${schema}: ${result.applied.length} applied, ${result.pending.length} pending.`,
    );
    for (const file of result.applied) console.log(`  = ${file}`);
    for (const file of result.pending) console.log(`  - ${file} (pending)`);
    return;
  }

  if (command === 'promote-admin') {
    try {
      const result = await promoteAdmin({ schema, connectionString, email: values.email! });
      const listed = result.addedToAllowlist ? 'added to' : 'already on';
      console.log(`${result.email}: ${listed} the allowlist of ${schema}.`);
      console.log(
        result.promoted
          ? 'Role set to admin.'
          : 'No account yet: sign in once, then run this command again to set the admin role.',
      );
    } catch (error) {
      if (error instanceof InvalidEmailError) throw new UsageError(error.message);
      throw error;
    }
    return;
  }

  const appPassword = env.APP_PASSWORD;
  const backupPassword = env.BACKUP_PASSWORD;
  if (!appPassword || !backupPassword) {
    throw new UsageError('APP_PASSWORD and BACKUP_PASSWORD must both be set.');
  }
  try {
    await setPasswords({ schema, connectionString, appPassword, backupPassword });
  } catch (error) {
    if (error instanceof Error && error.message.includes('characters long')) {
      throw new UsageError(error.message);
    }
    throw error;
  }
  console.log(`Passwords set for app_${schema} and backup_${schema}.`);
}

const env = process.env;
run(process.argv.slice(2), env).catch((error: unknown) => {
  const secrets = [
    env.DATABASE_URL,
    passwordOf(env.DATABASE_URL),
    env.APP_PASSWORD,
    env.BACKUP_PASSWORD,
  ];
  const message = redact(error instanceof Error ? error.message : 'Unknown error.', secrets);
  console.error(`Error: ${message}`);
  process.exitCode = error instanceof UsageError ? EXIT_USAGE : 1;
});
