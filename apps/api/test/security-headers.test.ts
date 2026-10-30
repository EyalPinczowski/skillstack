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
