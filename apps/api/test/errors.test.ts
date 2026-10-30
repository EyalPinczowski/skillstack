import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { errorResponseSchema } from '../src/errors';
import { testApp } from './helpers';

/** An app with two test-only routes: one validates input, one throws. */
function appWithTestRoutes(overrides: Parameters<typeof testApp>[0] = {}) {
  const app = testApp(overrides);
  app.get(
    '/test/validate',
    { schema: { querystring: z.object({ n: z.coerce.number().int() }) } },
    async () => ({
      ok: true,
    }),
  );
  app.get('/test/boom', async () => {
    throw new Error('secret database password is hunter2');
  });
  return app;
}

describe('error shape', () => {
  it('404 uses the single error shape', async () => {
    const app = appWithTestRoutes();
    const res = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });
    expect(res.statusCode).toBe(404);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error.code).toBe('not_found');
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
    await app.close();
  });

  it('maps validation failures to 400 validation_error', async () => {
    const app = appWithTestRoutes();
    const res = await app.inject({ method: 'GET', url: '/test/validate?n=abc' });
    expect(res.statusCode).toBe(400);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('validation_error');
    const ok = await app.inject({ method: 'GET', url: '/test/validate?n=3' });
    expect(ok.statusCode).toBe(200);
    await app.close();
  });

  it('maps unexpected errors to 500 internal_error without leaking details', async () => {
    const app = appWithTestRoutes();
    const res = await app.inject({ method: 'GET', url: '/test/boom' });
    expect(res.statusCode).toBe(500);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error.code).toBe('internal_error');
    expect(res.body).not.toContain('hunter2');
    expect(res.body).not.toContain('stack');
    expect(res.body).not.toMatch(/\bat .*\.ts/);
    await app.close();
  });

  it('keeps malformed JSON a client error in the same shape', async () => {
    const app = testApp();
    app.post('/test/echo', async () => ({ ok: true }));
    const res = await app.inject({
      method: 'POST',
      url: '/test/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('bad_request');
    await app.close();
  });
});

describe('rate limit', () => {
  it('returns 429 in the error shape once the limit is exceeded', async () => {
    const app = testApp({ rateLimitPerMinute: 2 });
    const hit = () => app.inject({ method: 'GET', url: '/api/v1/health' });
    expect((await hit()).statusCode).toBe(200);
    expect((await hit()).statusCode).toBe(200);
    const res = await hit();
    expect(res.statusCode).toBe(429);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
    await app.close();
  });
});
