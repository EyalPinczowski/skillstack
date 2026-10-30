import { describe, expect, it } from 'vitest';
import { testApp } from './helpers';

const allowed = 'https://app.example.com';

async function getWithOrigin(origin: string, corsOrigins = [allowed], url = '/api/v1/health') {
  const app = testApp({ corsOrigins });
  const res = await app.inject({ method: 'GET', url, headers: { origin } });
  await app.close();
  return res;
}

describe('CORS', () => {
  it('allows an origin on the list and exposes the tracing headers', async () => {
    const res = await getWithOrigin(allowed);
    expect(res.headers['access-control-allow-origin']).toBe(allowed);
    expect(res.headers['access-control-expose-headers']).toBe('x-request-id, retry-after');
  });

  it('does not allow an origin that is not on the list', async () => {
    const res = await getWithOrigin('https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('matches exactly, not by prefix or subdomain', async () => {
    const res = await getWithOrigin('https://app.example.com.evil.net');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('denies the opaque "null" origin even when other origins are allowed', async () => {
    const res = await getWithOrigin('null');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows no cross-origin request when the list is empty, and never answers with *', async () => {
    const res = await getWithOrigin(allowed, []);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('varies on Origin so caches do not mix up answers', async () => {
    const res = await getWithOrigin(allowed);
    expect(res.headers.vary).toMatch(/\bOrigin\b/);
  });

  it('keeps the CORS header on a 4xx response', async () => {
    const res = await getWithOrigin(allowed, [allowed], '/api/v1/does-not-exist');
    expect(res.statusCode).toBe(404);
    expect(res.headers['access-control-allow-origin']).toBe(allowed);
  });

  it('answers a preflight only for allowed origins, with explicit methods and headers', async () => {
    const app = testApp({ corsOrigins: [allowed] });
    const preflight = (origin: string) =>
      app.inject({
        method: 'OPTIONS',
        url: '/api/v1/health',
        headers: { origin, 'access-control-request-method': 'POST' },
      });
    const ok = await preflight(allowed);
    expect(ok.headers['access-control-allow-origin']).toBe(allowed);
    expect(ok.headers['access-control-allow-methods']).toBe(
      'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
    );
    expect(ok.headers['access-control-allow-headers']).toBe(
      'content-type, authorization, idempotency-key, x-request-id',
    );
    expect(
      (await preflight('https://evil.example.com')).headers['access-control-allow-origin'],
    ).toBeUndefined();
    await app.close();
  });
});
