import pg from 'pg';

/** App environment (APP_ENV) to the database schema it uses (ADR 003). The only two schemas. */
const SCHEMA_BY_APP_ENV = { operational: 'prod', rnd: 'rnd' } as const;

export type Schema = (typeof SCHEMA_BY_APP_ENV)[keyof typeof SCHEMA_BY_APP_ENV];

/** Role names per allowlisted schema. Nothing here is built from request or env text. */
const USER_ROLE: Record<Schema, string> = { prod: 'app_prod_user', rnd: 'app_rnd_user' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function schemaForAppEnv(appEnv: string): Schema {
  if (appEnv === 'operational' || appEnv === 'rnd') return SCHEMA_BY_APP_ENV[appEnv];
  throw new Error('Unknown APP_ENV: no database schema.');
}

/** Why provision_user refused. The API shows the same generic answer for every reason. */
export class ProvisionDeniedError extends Error {
  constructor(public readonly reason: 'not_allowed' | 'cap_reached') {
    super(`account not provisioned: ${reason}`);
    this.name = 'ProvisionDeniedError';
  }
}

export interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: 'user' | 'admin';
  status: 'active' | 'disabled' | 'deleted';
  created_at: Date;
  last_seen_at: Date | null;
}

/** What a request handler gets inside withUser: a client bound to the user's transaction. */
export interface UserContext {
  client: Pick<pg.PoolClient, 'query'>;
  /** The environment's schema name, from the allowlist, safe to put in SQL text. */
  schema: Schema;
}

export interface Database {
  readonly schema: Schema;
  /**
   * Runs `fn` in one transaction as `app_<schema>_user` with the verified user's claims, so
   * row-level security shows only that user's rows. Everything is inside the transaction, which
   * also makes it safe behind a transaction-mode pooler. Commits on success, rolls back on error.
   */
  withUser<T>(userId: string, fn: (ctx: UserContext) => Promise<T>): Promise<T>;
  /** Creates (or returns) the profile row via provision_user, as the app login. */
  provision(userId: string, email: string): Promise<UserRow>;
  close(): Promise<void>;
}

/** `date` columns stay plain 'YYYY-MM-DD' strings instead of being shifted by the server's zone. */
const DATE_OID = 1082;
const types = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
    oid === DATE_OID
      ? (value: string) => value
      : pg.types.getTypeParser(oid, format as 'text')) as typeof pg.types.getTypeParser,
};

export function createDatabase(options: {
  connectionString: string;
  appEnv: string;
  max?: number;
}): Database {
  const schema = schemaForAppEnv(options.appEnv);
  const role = USER_ROLE[schema];
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 5,
    types,
  });

  return {
    schema,

    async withUser(userId, fn) {
      if (!UUID.test(userId)) throw new Error('withUser needs a verified user id (UUID).');
      const client = await pool.connect();
      try {
        await client.query('begin');
        try {
          await client.query(`set local role ${role}`);
          await client.query(`select set_config('request.jwt.claims', $1, true)`, [
            JSON.stringify({ sub: userId }),
          ]);
          const result = await fn({ client, schema });
          await client.query('commit');
          return result;
        } catch (error) {
          await client.query('rollback').catch(() => undefined);
          throw error;
        }
      } finally {
        client.release();
      }
    },

    async provision(userId, email) {
      try {
        const { rows } = await pool.query<UserRow>(
          `select * from ${schema}.provision_user($1::uuid, $2::text)`,
          [userId, email],
        );
        return rows[0]!;
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'not_allowed' || message === 'cap_reached') {
          throw new ProvisionDeniedError(message);
        }
        throw error;
      }
    },

    async close() {
      await pool.end();
    },
  };
}
