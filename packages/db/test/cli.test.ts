import { describe, expect, it } from 'vitest';
import { runCli } from './helpers';

// A recognisable fake password: it must never appear in any output.
const FAKE_PASSWORD = 'Zx9-fake-PASSWORD-must-never-be-printed';
const FAKE_URL = `postgres://admin:${FAKE_PASSWORD}@127.0.0.1:1/nodb`;

describe('cli refuses unsafe invocations (no database needed)', () => {
  it('refuses to migrate without --schema', async () => {
    const result = await runCli(['migrate'], { DATABASE_URL: FAKE_URL });
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/Missing --schema/);
  });

  it.each(['public', 'PROD', 'Rnd', '', ' rnd', 'rnd; drop schema prod', 'prod,rnd', '"rnd"'])(
    'refuses --schema %j',
    async (schema) => {
      const result = await runCli(['migrate', '--schema', schema], { DATABASE_URL: FAKE_URL });
      expect(result.code).toBe(2);
      expect(result.stderr).toMatch(/Invalid schema/);
      // Rejected before connecting: a connection attempt would report a connection error.
      expect(result.stderr).not.toMatch(/ECONNREFUSED/);
      expect(result.stdout + result.stderr).not.toContain('drop schema');
    },
  );

  it('refuses status and set-passwords without --schema too', async () => {
    for (const command of ['status', 'set-passwords']) {
      const result = await runCli([command], { DATABASE_URL: FAKE_URL });
      expect(result.code).toBe(2);
      expect(result.stderr).toMatch(/Missing --schema/);
    }
  });

  it('refuses to run without DATABASE_URL', async () => {
    const result = await runCli(['migrate', '--schema', 'rnd']);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/DATABASE_URL is not set/);
  });

  it('refuses set-passwords with short passwords, before connecting', async () => {
    const result = await runCli(['set-passwords', '--schema', 'rnd'], {
      DATABASE_URL: FAKE_URL,
      APP_PASSWORD: 'short-app-password',
      BACKUP_PASSWORD: 'short-backup-password',
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/at least 24 characters/);
    expect(result.stdout + result.stderr).not.toContain('short-app-password');
    expect(result.stderr).not.toMatch(/ECONNREFUSED/);
  });

  it('never prints the connection string or its password, even when connecting fails', async () => {
    for (const args of [
      ['migrate', '--schema', 'rnd'],
      ['migrate', '--schema', 'rnd', '--dry-run'],
      ['status', '--schema', 'prod'],
    ]) {
      const result = await runCli(args, { DATABASE_URL: FAKE_URL });
      expect(result.code).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/Error:/);
      expect(output).not.toContain(FAKE_PASSWORD);
      expect(output).not.toContain(FAKE_URL);
      expect(output).not.toContain('admin:');
    }
  });

  it('does not leak a malformed connection string either', async () => {
    const badUrl = `postgres://admin:${FAKE_PASSWORD}@[not-a-host`;
    const result = await runCli(['migrate', '--schema', 'rnd'], { DATABASE_URL: badUrl });
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(FAKE_PASSWORD);
  });
});

describe('promote-admin hides the address in GitHub Actions (no database needed)', () => {
  const EMAIL = 'Hidden.Owner@example.com';
  const gh = { DATABASE_URL: FAKE_URL, GITHUB_ACTIONS: 'true' };

  it('prints no address on the invalid-email path, nor in a connection error', async () => {
    const bad = await runCli(['promote-admin', '--schema', 'rnd', '--email', 'not an @ email'], gh);
    expect(bad.code).toBe(2);
    expect(bad.stdout + bad.stderr).not.toContain('not an @ email');
    // Valid address, unreachable database: the error must not echo the address either.
    const down = await runCli(['promote-admin', '--schema', 'rnd', '--email', EMAIL], gh);
    expect(down.code).toBe(1);
    const output = (down.stdout + down.stderr).toLowerCase();
    expect(output).not.toContain(EMAIL.toLowerCase());
    expect(output).not.toContain('example.com');
  });
});
