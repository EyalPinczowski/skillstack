import { APP_NAME } from '@skillstack/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import { buildApp } from '../src/app';
import type { Database, PingResult } from '../src/db/database';
import { createDatabaseProbe } from '../src/modules/health/probe';
import { testApp, testConfig } from './helpers';

const apps: ReturnType<typeof testApp>[] = [];
const make = (...args: Parameters<typeof testApp>) => {
  const app = testApp(...args);
  apps.push(app);
  return app;
};
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

describe('GET /api/v1/health', () => {
  it('returns status, app name, environment, package version and an ISO time', async () => {
    const before = Date.now();
    const res = await make({ appEnv: 'rnd' }).inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({
      status: 'ok',
      app: APP_NAME,
      environment: 'rnd',
      version: pkg.version,
      time: expect.any(String),
      database: 'not_configured',
    });
    expect(new Date(body.time).toISOString()).toBe(body.time);
    expect(new Date(body.time).getTime()).toBeGreaterThanOrEqual(before);
  });
});

/** An app with a fake database whose ping the test controls. */
function appWithPing(ping: () => Promise<PingResult>) {
  const db = { ping, close: async () => undefined } as unknown as Database;
  const app = buildApp(testConfig({ appEnv: 'rnd' }), { db });
  apps.push(app);
  return app;
}

const SECRET = 'postgres://app_rnd:very-secret@db.internal.example:5432/postgres';

describe('database field and readiness', () => {
  it('reports database ok and keeps the status 200', async () => {
    const app = appWithPing(async () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', database: 'ok' });
  });

  it.each([
    { ok: false, reason: 'error' },
    { ok: false, reason: 'timeout' },
  ] as PingResult[])(
    'stays 200 with database unavailable when the ping fails (%o), so Render keeps the service',
    async (result) => {
      const app = appWithPing(async () => result);
      const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'ok', database: 'unavailable' });
    },
  );

  it('does not throw or leak anything when the ping itself throws', async () => {
    const app = appWithPing(async () => {
      throw new Error(`connect ECONNREFUSED ${SECRET}`);
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().database).toBe('unavailable');
    expect(res.body).not.toContain('very-secret');
    expect(res.body).not.toContain('internal.example');
  });

  it('needs no authentication and is not rate limited', async () => {
    const app = buildApp(testConfig({ appEnv: 'rnd', rateLimitPerMinute: 1 }), {
      db: { ping: async () => ({ ok: true }), close: async () => undefined } as unknown as Database,
    });
    apps.push(app);
    for (let i = 0; i < 3; i += 1) {
      const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(res.statusCode).toBe(200);
    }
  });

  it('GET /health/ready answers 200 when the database answers', async () => {
    const app = appWithPing(async () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', database: 'ok' });
  });

  it('GET /health/ready answers 503 when the database is down, with the same one error-free shape', async () => {
    const app = appWithPing(async () => {
      throw new Error(SECRET);
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'unavailable', database: 'unavailable' });
    expect(res.body).not.toContain('very-secret');
  });

  it('GET /health/ready answers 503 when no database is configured', async () => {
    const res = await make({ appEnv: 'rnd' }).inject({
      method: 'GET',
      url: '/api/v1/health/ready',
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'unavailable', database: 'not_configured' });
  });

  it('GET /health/ready is rate limited, unlike /health', async () => {
    const app = buildApp(testConfig({ appEnv: 'rnd', rateLimitPerMinute: 1 }), {
      db: { ping: async () => ({ ok: true }), close: async () => undefined } as unknown as Database,
    });
    apps.push(app);
    const first = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    const second = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
  });
});

describe('createDatabaseProbe', () => {
  it('asks the database once per cache window, even for concurrent callers', async () => {
    vi.useFakeTimers();
    try {
      const ping = vi.fn(async (): Promise<PingResult> => ({ ok: true }));
      const probe = createDatabaseProbe({ ping } as unknown as Database, { cacheMs: 5000 });
      await Promise.all([probe.check(), probe.check(), probe.check()]);
      expect(ping).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(4999);
      await probe.check();
      expect(ping).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2);
      await probe.check();
      expect(ping).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caches a failure too, so a down database cannot be hammered through /health', async () => {
    const ping = vi.fn(async (): Promise<PingResult> => ({ ok: false, reason: 'error' }));
    const probe = createDatabaseProbe({ ping } as unknown as Database, { cacheMs: 5000 });
    expect(await probe.check()).toBe('unavailable');
    expect(await probe.check()).toBe('unavailable');
    expect(ping).toHaveBeenCalledTimes(1);
  });
});

describe('docs', () => {
  it('serves Swagger UI', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/v1/docs/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('serves an OpenAPI document that lists the health route', async () => {
    const res = await make().inject({ method: 'GET', url: '/api/v1/openapi.json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.paths['/api/v1/health'].get.responses['200']).toBeDefined();
    expect(doc.paths['/api/v1/openapi.json']).toBeUndefined();
  });
});
