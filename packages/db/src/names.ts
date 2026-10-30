/** The only two environments. Each one is a schema in the shared database (ADR 003). */
export const ENVIRONMENTS = ['prod', 'rnd'] as const;

export type Environment = (typeof ENVIRONMENTS)[number];

/** Database object names of one environment, all derived from the schema name. */
export interface EnvironmentNames {
  schema: Environment;
  /** NOLOGIN, owns the schema and every object in it. */
  owner: string;
  /** The backend's login role. Has no privileges until it switches to `appUser`. */
  app: string;
  /** NOLOGIN role the backend switches to inside each request transaction. */
  appUser: string;
  /** Read-only login role for backups. */
  backup: string;
}

export class InvalidSchemaError extends Error {
  constructor(value: unknown) {
    // The value is deliberately not echoed back: it may be attacker-controlled text.
    super(
      `Invalid schema ${typeof value === 'string' ? `(${value.length} characters)` : '(not a string)'}: ` +
        `it must be exactly one of ${ENVIRONMENTS.join(', ')}.`,
    );
    this.name = 'InvalidSchemaError';
  }
}

export function isEnvironment(value: unknown): value is Environment {
  return typeof value === 'string' && (ENVIRONMENTS as readonly string[]).includes(value);
}

/** Returns the value as an Environment or throws. Exact match only: no trimming, no case folding. */
export function parseEnvironment(value: unknown): Environment {
  if (!isEnvironment(value)) throw new InvalidSchemaError(value);
  return value;
}

export function environmentNames(schema: Environment): EnvironmentNames {
  parseEnvironment(schema);
  return {
    schema,
    owner: `owner_${schema}`,
    app: `app_${schema}`,
    appUser: `app_${schema}_user`,
    backup: `backup_${schema}`,
  };
}
