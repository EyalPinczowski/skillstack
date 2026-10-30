import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { errorResponseSchema } from '../src/errors';
import { testApp } from './helpers';

/** An app with test-only routes: one validates input, one throws, one fails with a given status. */
function appWithTestRoutes() {
  const app = testApp();
  app.get(
    '/test/validate',
    { schema: { querystring: z.object({ n: z.coerce.number().int() }) } },
    async () => ({ ok: true }),
  );
  app.get('/test/boom', async () => {
    throw new Error('secret database password is hunter2');
  });
  app.get('/test/status/:code', async (request) => {
    const { code } = request.params as { code: string };
    throw Object.assign(new Error('internal detail xyzzy'), { statusCode: Number(code) });
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

describe('error codes follow the status', () => {
  it.each([
    [400, 'bad_request'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [422, 'unprocessable'],
    [429, 'rate_limited'],
    [418, 'client_error'],
    [451, 'client_error'],
  ])('%i becomes %s', async (status, code) => {
    const app = appWithTestRoutes();
    const res = await app.inject({ method: 'GET', url: `/test/status/${status}` });
    expect(res.statusCode).toBe(status);
    const { error } = errorResponseSchema.parse(res.json());
    expect(error.code).toBe(code);
    expect(res.body).not.toContain('xyzzy');
    await app.close();
  });

  it('only 400 uses the 400 message', async () => {
    const app = appWithTestRoutes();
    const messages = new Map<number, string>();
    for (const status of [400, 401, 403, 409, 418, 422]) {
      const res = await app.inject({ method: 'GET', url: `/test/status/${status}` });
      messages.set(status, errorResponseSchema.parse(res.json()).error.message);
    }
    for (const status of [401, 403, 409, 418, 422]) {
      expect(messages.get(status)).not.toBe(messages.get(400));
    }
    await app.close();
  });
});
