import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate, setPasswords } from '../src/index';
import {
  TEST_DATABASE_URL,
  connect,
  dbAvailable,
  resetEnvironments,
  runCli,
  urlFor,
} from './helpers';

describe.skipIf(!dbAvailable)('set-passwords', () => {
  beforeAll(async () => {
    await resetEnvironments();
    await migrate({ schema: 'rnd', connectionString: TEST_DATABASE_URL! });
  });

  it('refuses passwords shorter than 24 characters and sets nothing', async () => {
    const short = 'x'.repeat(23);
    await expect(
      setPasswords({
        schema: 'rnd',
        connectionString: TEST_DATABASE_URL!,
        appPassword: short,
        backupPassword: randomBytes(18).toString('hex'),
      }),
    ).rejects.toThrow(/APP_PASSWORD must be at least 24 characters/);
    await expect(connect(urlFor(TEST_DATABASE_URL!, 'app_rnd', short))).rejects.toThrow();
  });

  it('cannot log in before a password is set', async () => {
    await expect(
      connect(urlFor(TEST_DATABASE_URL!, 'app_rnd', 'anything-at-all-1234567890')),
    ).rejects.toThrow(/password authentication failed/);
  });

  it('sets working passwords through the CLI and never prints them', async () => {
    const appPassword = `a-${randomBytes(18).toString('hex')}`;
    const backupPassword = `b-${randomBytes(18).toString('hex')}`;
    const result = await runCli(['set-passwords', '--schema', 'rnd'], {
      DATABASE_URL: TEST_DATABASE_URL!,
      APP_PASSWORD: appPassword,
      BACKUP_PASSWORD: backupPassword,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Passwords set for app_rnd and backup_rnd/);
    for (const output of [result.stdout, result.stderr]) {
      expect(output).not.toContain(appPassword);
      expect(output).not.toContain(backupPassword);
    }

    const app = await connect(urlFor(TEST_DATABASE_URL!, 'app_rnd', appPassword));
    const who = await app.query('select current_user as u');
    expect(who.rows).toEqual([{ u: 'app_rnd' }]);
    await app.end();
    const backup = await connect(urlFor(TEST_DATABASE_URL!, 'backup_rnd', backupPassword));
    await backup.end();
    // The passwords are not interchangeable.
    await expect(connect(urlFor(TEST_DATABASE_URL!, 'app_rnd', backupPassword))).rejects.toThrow();
  });

  it('refuses short passwords in the CLI with exit code 2 and does not echo them', async () => {
    const result = await runCli(['set-passwords', '--schema', 'rnd'], {
      DATABASE_URL: TEST_DATABASE_URL!,
      APP_PASSWORD: 'tooshort-app-secret',
      BACKUP_PASSWORD: randomBytes(18).toString('hex'),
    });
    expect(result.code).toBe(2);
    expect(result.stdout + result.stderr).not.toContain('tooshort-app-secret');
  });
});

const MIGRATION_COUNT = readdirSync(new URL('../migrations/', import.meta.url)).filter((f) =>
  f.endsWith('.sql'),
).length;

describe.skipIf(!dbAvailable)('cli migrate and status against a real database', () => {
  beforeAll(resetEnvironments);

  it('reports pending, applies, then reports applied', async () => {
    const env = { DATABASE_URL: TEST_DATABASE_URL! };
    const dry = await runCli(['migrate', '--schema', 'rnd', '--dry-run'], env);
    expect(dry.code).toBe(0);
    expect(dry.stdout).toMatch(
      new RegExp(`Would apply ${MIGRATION_COUNT} migration.s. on schema rnd`),
    );
    const real = await runCli(['migrate', '--schema', 'rnd'], env);
    expect(real.code).toBe(0);
    expect(real.stdout).toMatch(new RegExp(`Applied ${MIGRATION_COUNT} migration`));
    const status = await runCli(['status', '--schema', 'rnd'], env);
    expect(status.stdout).toMatch(new RegExp(`${MIGRATION_COUNT} applied, 0 pending`));
    expect(real.stdout + real.stderr).not.toContain(TEST_DATABASE_URL!);
  });
});
