import type { InjectOptions } from 'fastify';
import { describe, expect, it } from 'vitest';
import { errorResponseSchema } from '../src/errors';
import { testApp } from './helpers';

/** An app with a rate-limited test route; the real health route is exempt from the limit. */
function limitedApp(overrides: Parameters<typeof testApp>[0]) {
  const app = testApp(overrides);
  app.get('/test/ping', async () => ({ ok: true }));
  return app;
}

/** Sends `count` requests and returns their status codes. */
async function statuses(
  app: ReturnType<typeof testApp>,
  count: number,
  request: (i: number) => InjectOptions,
) {
  const codes: number[] = [];
  for (let i = 0; i < count; i++) codes.push((await app.inject(request(i))).statusCode);
  return codes;
}

describe('rate limit', () => {
  it('returns 429 in the error shape once the limit is exceeded', async () => {
    const app = limitedApp({ rateLimitPerMinute: 2 });
    const hit = () => app.inject({ method: 'GET', url: '/test/ping' });
    expect((await hit()).statusCode).toBe(200);
    expect((await hit()).statusCode).toBe(200);
    const res = await hit();
    expect(res.statusCode).toBe(429);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
    await app.close();
  });

  it('also limits 404 responses', async () => {
    const app = limitedApp({ rateLimitPerMinute: 2 });
    const codes = await statuses(app, 3, () => ({ method: 'GET', url: '/api/v1/nothing-here' }));
    expect(codes).toEqual([404, 404, 429]);
    const res = await app.inject({ method: 'GET', url: '/api/v1/nothing-here' });
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('rate_limited');
    await app.close();
  });

  it('sends CORS headers on a 429 too', async () => {
    const origin = 'https://app.example.com';
    const app = limitedApp({ rateLimitPerMinute: 1, corsOrigins: [origin] });
    await app.inject({ method: 'GET', url: '/test/ping' });
    const res = await app.inject({ method: 'GET', url: '/test/ping', headers: { origin } });
    expect(res.statusCode).toBe(429);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
    await app.close();
  });
});

describe('health exemption', () => {
  it('keeps answering health after the limit is used up, while other routes get 429', async () => {
    const app = limitedApp({ rateLimitPerMinute: 2 });
    const ping = () => app.inject({ method: 'GET', url: '/test/ping' });
    await ping();
    await ping();
    expect((await ping()).statusCode).toBe(429);
    for (let i = 0; i < 5; i++) {
      const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(health.statusCode).toBe(200);
    }
    expect((await ping()).statusCode).toBe(429);
    await app.close();
  });

  it('does not count health requests against the bucket', async () => {
    const app = limitedApp({ rateLimitPerMinute: 2 });
    for (let i = 0; i < 5; i++) await app.inject({ method: 'GET', url: '/api/v1/health' });
    const res = await app.inject({ method: 'GET', url: '/test/ping' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe('rate limit and X-Forwarded-For', () => {
  const spoofed = (i: number) => ({
    method: 'GET' as const,
    url: '/test/ping',
    remoteAddress: '10.0.0.1',
    headers: { 'x-forwarded-for': `203.0.113.${i + 1}` },
  });

  it('ignores the header by default, so spoofing does not give a fresh bucket', async () => {
    const app = limitedApp({ rateLimitPerMinute: 2 });
    expect(await statuses(app, 4, spoofed)).toEqual([200, 200, 429, 429]);
    await app.close();
  });

  it('with one trusted hop, keys on the right-most address and ignores the left-most', async () => {
    const app = limitedApp({ rateLimitPerMinute: 2, trustProxy: 1 });
    // The proxy appended 198.51.100.7; the client rotates the left-most entry.
    const sameClient = (i: number) => ({
      method: 'GET' as const,
      url: '/test/ping',
      remoteAddress: '10.0.0.1',
      headers: { 'x-forwarded-for': `203.0.113.${i + 1}, 198.51.100.7` },
    });
    expect(await statuses(app, 3, sameClient)).toEqual([200, 200, 429]);

    // A different right-most address is a different client with its own bucket.
    const other = await app.inject({
      method: 'GET',
      url: '/test/ping',
      remoteAddress: '10.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.1, 198.51.100.8' },
    });
    expect(other.statusCode).toBe(200);
    await app.close();
  });

  it('with two trusted hops, keys on the second address from the right', async () => {
    const app = limitedApp({ rateLimitPerMinute: 2, trustProxy: 2 });
    // a is rotated by the client, b was seen by the outer proxy, c was appended by the inner one.
    const client = (i: number, b = '198.51.100.7') => ({
      method: 'GET' as const,
      url: '/test/ping',
      remoteAddress: '10.0.0.1',
      headers: { 'x-forwarded-for': `203.0.113.${i + 1}, ${b}, 192.0.2.99` },
    });
    expect(await statuses(app, 3, (i) => client(i))).toEqual([200, 200, 429]);
    const other = await app.inject(client(0, '198.51.100.8'));
    expect(other.statusCode).toBe(200);
    await app.close();
  });
});
