import { describe, expect, it } from 'vitest';
import { testApp } from './helpers';

const KEY = '3b0f4b1e-6d47-4a5e-9d0a-5a2f0e8d7c11';
const ORIGIN = 'https://app.example.com';

function appWithEcho(overrides: Parameters<typeof testApp>[0] = {}) {
  const app = testApp(overrides);
  app.get('/test/key', async (request) => ({ key: request.idempotencyKey ?? null }));
  return app;
}

describe('Idempotency-Key header', () => {
  it('exposes a valid UUID on the request', async () => {
    const app = appWithEcho();
    const res = await app.inject({
      method: 'GET',
      url: '/test/key',
      headers: { 'idempotency-key': KEY },
    });
    expect(res.json()).toEqual({ key: KEY });
    await app.close();
  });

  it('leaves it undefined when absent', async () => {
    const app = appWithEcho();
    const res = await app.inject({ method: 'GET', url: '/test/key' });
    expect(res.json()).toEqual({ key: null });
    await app.close();
  });

  it('rejects a key that is not a UUID with the validation error shape', async () => {
    const app = appWithEcho();
    const res = await app.inject({
      method: 'GET',
      url: '/test/key',
      headers: { 'idempotency-key': 'not-a-uuid' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });

  it('still sends CORS headers when the key is rejected', async () => {
    const app = appWithEcho({ corsOrigins: [ORIGIN] });
    const res = await app.inject({
      method: 'GET',
      url: '/test/key',
      headers: { 'idempotency-key': 'nope', origin: ORIGIN },
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    await app.close();
  });

  it('counts rejected keys against the rate limit', async () => {
    const app = appWithEcho({ rateLimitPerMinute: 2 });
    const bad = () =>
      app.inject({ method: 'GET', url: '/test/key', headers: { 'idempotency-key': 'nope' } });
    expect((await bad()).statusCode).toBe(400);
    expect((await bad()).statusCode).toBe(400);
    const res = await bad();
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('rate_limited');
    await app.close();
  });
});
