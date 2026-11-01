import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { CONNECT_TIMEOUT_MS, createClient, formatError } from '../src/connection';
import { runCli } from './helpers';

function netError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('formatError', () => {
  it('lists the inner errors of an AggregateError with an empty message', () => {
    const error = new AggregateError([
      netError('ENETUNREACH', 'connect ENETUNREACH 2a05:d018::1:5432 - Local (:::0)'),
      netError('ETIMEDOUT', 'connect ETIMEDOUT 3.64.0.1:5432'),
    ]);
    expect(error.message).toBe('');
    const text = formatError(error);
    expect(text).toContain('ENETUNREACH');
    expect(text).toContain('ETIMEDOUT');
    expect(text).toMatch(/Session pooler/);
    expect(text).toMatch(/pooler\.supabase\.com/);
  });

  it('falls back to the code, then the name, for empty messages', () => {
    expect(formatError(Object.assign(new Error(''), { code: 'ECONNREFUSED' }))).toContain(
      'ECONNREFUSED',
    );
    class WeirdError extends Error {
      override name = 'WeirdError';
    }
    expect(formatError(new WeirdError(''))).toBe('WeirdError');
    expect(formatError('boom')).toBe('boom');
    expect(formatError(undefined)).toBe('Unknown error');
  });

  it('names an auth failure by its code', () => {
    const text = formatError(netError('28P01', 'password authentication failed for user "x"'));
    expect(text).toContain('28P01');
    expect(text).toMatch(/Session pooler/);
  });

  it('redacts URLs and given secrets', () => {
    const text = formatError(new Error('failed for postgres://user:secret@host/db at start'), [
      'hunter2-secret',
    ]);
    expect(text).not.toContain('secret@');
    expect(text).not.toContain('user:');
    expect(text).not.toContain('host/db');
    const text2 = formatError(new Error('bad value hunter2-secret here'), ['hunter2-secret']);
    expect(text2).not.toContain('hunter2-secret');
  });

  it('redacts URLs inside inner errors', () => {
    const text = formatError(new AggregateError([new Error('x postgres://u:pw123@h:1/d y')]));
    expect(text).not.toContain('pw123');
  });

  it('adds no pooler hint to unrelated errors', () => {
    expect(formatError(new Error('relation does not exist'))).not.toMatch(/pooler/);
  });
});

describe('connecting', () => {
  it('uses a 15 second default timeout', () => {
    expect(CONNECT_TIMEOUT_MS).toBe(15_000);
  });

  it('fails within the timeout when the server never answers, with a useful message', async () => {
    const sockets: net.Socket[] = [];
    const server = net.createServer((socket) => sockets.push(socket));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;
    const started = Date.now();
    try {
      const client = createClient(`postgres://u:secretpw@127.0.0.1:${port}/db`, 300);
      const error = await client.connect().then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(Error);
      expect(Date.now() - started).toBeLessThan(5_000);
      const text = formatError(error, ['secretpw']);
      expect(text).toMatch(/timeout/i);
      expect(text).not.toContain('secretpw');
      await client.end().catch(() => undefined);
    } finally {
      sockets.forEach((s) => s.destroy());
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('the CLI prints a non-empty error for a closed port, without secrets', async () => {
    const result = await runCli(['migrate', '--schema', 'rnd', '--dry-run'], {
      DATABASE_URL: 'postgres://admin:cli-secret-pw@127.0.0.1:1/nodb',
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^Error: \S/);
    expect(result.stderr).toMatch(/ECONNREFUSED/);
    expect(result.stderr).toMatch(/Session pooler/);
    expect(result.stdout + result.stderr).not.toContain('cli-secret-pw');
  });
});
