import { describe, expect, it } from 'vitest';
import { testApp } from './helpers';

const allowed = 'https://app.example.com';

async function getWithOrigin(origin: string, corsOrigins = [allowed]) {
  const app = testApp({ corsOrigins });
  const res = await app.inject({ method: 'GET', url: '/api/v1/health', headers: { origin } });
  await app.close();
  return res;
}

describe('CORS', () => {
  it('allows an origin on the list', async () => {
    const res = await getWithOrigin(allowed);
    expect(res.headers['access-control-allow-origin']).toBe(allowed);
  });

  it('does not allow an origin that is not on the list', async () => {
    const res = await getWithOrigin('https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('matches exactly, not by prefix or subdomain', async () => {
    const res = await getWithOrigin('https://app.example.com.evil.net');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows no cross-origin request when the list is empty, and never answers with *', async () => {
    const res = await getWithOrigin(allowed, []);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers a preflight only for allowed origins', async () => {
    const app = testApp({ corsOrigins: [allowed] });
    const preflight = (origin: string) =>
      app.inject({
        method: 'OPTIONS',
        url: '/api/v1/health',
        headers: { origin, 'access-control-request-method': 'GET' },
      });
    expect((await preflight(allowed)).headers['access-control-allow-origin']).toBe(allowed);
    expect(
      (await preflight('https://evil.example.com')).headers['access-control-allow-origin'],
    ).toBeUndefined();
    await app.close();
  });
});
