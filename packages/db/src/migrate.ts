import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { environmentNames, parseEnvironment, type EnvironmentNames } from './names';
import { renderSql } from './render';

const BOOTSTRAP_FILE = new URL('../sql/bootstrap.sql', import.meta.url);
const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
const MIGRATION_FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export interface MigrateOptions {
  /** Must be exactly `prod` or `rnd`. There is no default. */
  schema: string;
  /** Admin connection. Either this or `client`. */
  connectionString?: string;
  /** An already connected admin client. The caller closes it. */
  client?: pg.Client;
  /** List what would run and change nothing (not even the bootstrap). */
  dryRun?: boolean;
  /** Defaults to the migrations folder of this package. */
  migrationsDir?: string;
}

export interface MigrateResult {
  /** File names that were applied (with `dryRun`: that would be applied). */
  applied: string[];
  /** File names that were already applied. */
  skipped: string[];
}

interface MigrationFile {
  file: string;
  version: string;
  name: string;
  checksum: string;
  sql: string;
}

interface LedgerRow {
  version: string;
  name: string;
  checksum: string;
}

async function loadMigrations(dir: string): Promise<MigrationFile[]> {
  const entries = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const migrations: MigrationFile[] = [];
  for (const file of entries) {
    const match = MIGRATION_FILE.exec(file);
    if (!match) throw new Error(`Migration file name must look like 0001_name.sql: ${file}`);
    const sql = await readFile(`${dir}/${file}`, 'utf8');
    migrations.push({
      file,
      version: match[1]!,
      name: match[2]!,
      checksum: createHash('sha256').update(sql).digest('hex'),
      sql,
    });
  }
  return migrations;
}

/** Runs `work` on a connected client; opens and closes its own connection when given a URL. */
async function withClient<T>(
  options: Pick<MigrateOptions, 'client' | 'connectionString'>,
  work: (client: pg.Client) => Promise<T>,
): Promise<T> {
  if (options.client) return work(options.client);
  if (!options.connectionString) throw new Error('Either connectionString or client is required.');
  const client = new pg.Client({ connectionString: options.connectionString });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function inTransaction<T>(client: pg.Client, work: () => Promise<T>): Promise<T> {
  await client.query('begin');
  try {
    const result = await work();
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

/** Reads the ledger of the schema, or an empty list when the environment does not exist yet. */
async function readLedger(client: pg.Client, names: EnvironmentNames): Promise<LedgerRow[]> {
  const { rows: exists } = await client.query<{ ok: boolean }>(
    `select exists (select from pg_namespace where nspname = $1)
        and exists (select from pg_roles where rolname = $2) as ok`,
    [names.schema, names.owner],
  );
  if (!exists[0]?.ok) return [];
  return inTransaction(client, async () => {
    // The ledger belongs to the owner role; the admin reads it by becoming that role.
    await client.query(`set local role ${names.owner}`);
    const { rows: table } = await client.query<{ found: boolean }>(
      `select to_regclass($1) is not null as found`,
      [`${names.schema}.schema_migrations`],
    );
    if (!table[0]?.found) return [];
    const { rows } = await client.query<LedgerRow>(
      `select version, name, checksum from ${names.schema}.schema_migrations order by version`,
    );
    return rows;
  });
}

function checkLedger(ledger: LedgerRow[], migrations: MigrationFile[]): void {
  const byVersion = new Map(migrations.map((m) => [m.version, m]));
  for (const row of ledger) {
    const file = byVersion.get(row.version);
    if (!file) {
      throw new Error(`Migration ${row.version}_${row.name} was applied but its file is missing.`);
    }
    if (file.checksum !== row.checksum) {
      throw new Error(
        `Migration ${file.file} was changed after it was applied (checksum mismatch). ` +
          'Applied migrations are never edited: add a new migration instead.',
      );
    }
  }
}

async function plan(
  client: pg.Client,
  names: EnvironmentNames,
  migrations: MigrationFile[],
): Promise<{ applied: MigrationFile[]; pending: MigrationFile[] }> {
  const ledger = await readLedger(client, names);
  checkLedger(ledger, migrations);
  const done = new Set(ledger.map((row) => row.version));
  return {
    applied: migrations.filter((m) => done.has(m.version)),
    pending: migrations.filter((m) => !done.has(m.version)),
  };
}

/**
 * Applies the pending migrations to one environment schema. The schema is mandatory and must be
 * `prod` or `rnd`; anything else is rejected before any connection is made.
 */
export async function migrate(options: MigrateOptions): Promise<MigrateResult> {
  const names = environmentNames(parseEnvironment(options.schema));
  const migrations = await loadMigrations(options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR);

  return withClient(options, async (client) => {
    if (options.dryRun) {
      const { applied, pending } = await plan(client, names, migrations);
      return { applied: pending.map((m) => m.file), skipped: applied.map((m) => m.file) };
    }

    // One migration run per schema at a time. The lock is held by this connection and is
    // released explicitly below or, at the latest, when the connection closes.
    await client.query('select pg_advisory_lock(hashtextextended($1, 0))', [
      `skillstack:migrate:${names.schema}`,
    ]);
    try {
      const bootstrap = renderSql(await readFile(BOOTSTRAP_FILE, 'utf8'), names);
      await inTransaction(client, async () => {
        await client.query(bootstrap);
      });

      const { applied, pending } = await plan(client, names, migrations);
      for (const migration of pending) {
        try {
          await inTransaction(client, async () => {
            await client.query(renderSql(migration.sql, names));
            // Record it as the owner role, which owns the ledger. A migration may have
            // switched role, so set it explicitly.
            await client.query(`set local role ${names.owner}`);
            await client.query(
              `insert into ${names.schema}.schema_migrations (version, name, checksum)
               values ($1, $2, $3)`,
              [migration.version, migration.name, migration.checksum],
            );
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Migration ${migration.file} failed: ${message}`, { cause: error });
        }
      }
      return { applied: pending.map((m) => m.file), skipped: applied.map((m) => m.file) };
    } finally {
      // If the connection is already broken the original error is the useful one.
      await client
        .query('select pg_advisory_unlock(hashtextextended($1, 0))', [
          `skillstack:migrate:${names.schema}`,
        ])
        .catch(() => undefined);
    }
  });
}

export interface StatusResult {
  applied: string[];
  pending: string[];
}

/** Read-only: which migrations are applied to the environment and which are still pending. */
export async function migrationStatus(
  options: Omit<MigrateOptions, 'dryRun'>,
): Promise<StatusResult> {
  const result = await migrate({ ...options, dryRun: true });
  return { applied: result.skipped, pending: result.applied };
}
