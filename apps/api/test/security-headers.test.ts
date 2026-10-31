import { describe, expect, it } from 'vitest';
import { testApp } from './helpers';

describe('security headers', () => {
  it.each([
    ['a successful response', '/api/v1/health'],
    ['a 404 response', '/api/v1/missing'],
    ['the docs page', '/api/v1/docs/'],
  ])('are set on %s', async (_label, url) => {
    const app = testApp();
    const res = await app.inject({ method: 'GET', url });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    await app.close();
  });
});

describe('content security policy', () => {
  it.each([
    ['a successful response', '/api/v1/health'],
    ['the OpenAPI document', '/api/v1/openapi.json'],
    ['a 404 response', '/api/v1/missing'],
    ['a 401 response', '/api/v1/me'],
  ])('is default-src none with no framing on %s', async (_label, url) => {
    const app = testApp();
    const res = await app.inject({ method: 'GET', url });
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    await app.close();
  });

  it('gives only the Swagger UI its own policy, still without framing or inline script', async () => {
    const app = testApp();
    for (const url of ['/api/v1/docs/', '/api/v1/docs/static/swagger-ui.css']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      const csp = String(res.headers['content-security-policy']);
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toMatch(/style-src 'self' https: 'sha256-[A-Za-z0-9+/=]+'/);
      expect(csp).not.toContain('unsafe-inline');
      expect(csp).not.toContain('upgrade-insecure-requests');
      expect(csp).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/);
    }
    await app.close();
  });
});
