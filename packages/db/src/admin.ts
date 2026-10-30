import pg from 'pg';
import { environmentNames, parseEnvironment } from './names';

export interface PromoteAdminOptions {
  /** Must be exactly `prod` or `rnd`. There is no default. */
  schema: string;
  /** Admin connection (a role that can SET ROLE owner_<schema>). */
  connectionString: string;
  email: string;
}

export interface PromoteAdminResult {
  email: string;
  /** True when the email was not on the allowlist before. */
  addedToAllowlist: boolean;
  /** True when an account exists and now has role admin. False: the person has not signed in yet. */
  promoted: boolean;
}

export class InvalidEmailError extends Error {
  constructor() {
    super('Invalid email address.');
    this.name = 'InvalidEmailError';
  }
}

/** Lower-cases and trims; accepts only a simple local@domain shape without whitespace. */
export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  // Plain string checks instead of a regular expression: no backtracking on hostile input.
  const at = email.indexOf('@');
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const valid =
    email.length <= 254 &&
    !/\s/.test(email) &&
    at > 0 &&
    at === email.lastIndexOf('@') &&
    dot > 0 &&
    dot < domain.length - 1;
  if (!valid) throw new InvalidEmailError();
  return email;
}

/**
 * The only way to become admin (spec 3.A): puts the email on the allowlist and, if the person
 * already has an account, sets its role to admin. It runs as the owner role, because the app
 * role cannot change `role`. If there is no account yet, run it again after the first sign-in.
 */
export async function promoteAdmin(options: PromoteAdminOptions): Promise<PromoteAdminResult> {
  const names = environmentNames(parseEnvironment(options.schema));
  const email = normalizeEmail(options.email);
  const client = new pg.Client({ connectionString: options.connectionString });
  await client.connect();
  try {
    await client.query('begin');
    try {
      await client.query(`set local role ${names.owner}`);
      const added = await client.query(
        `insert into ${names.schema}.allowed_emails (email, added_by) values ($1, 'promote-admin')
         on conflict (email) do nothing`,
        [email],
      );
      const updated = await client.query(
        `update ${names.schema}.app_users set role = 'admin' where lower(email) = $1`,
        [email],
      );
      await client.query('commit');
      return {
        email,
        addedToAllowlist: (added.rowCount ?? 0) > 0,
        promoted: (updated.rowCount ?? 0) > 0,
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  } finally {
    await client.end();
  }
}
