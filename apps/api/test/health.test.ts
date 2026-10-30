import { APP_NAME } from '@skillstack/shared';
import { afterEach, describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import { testApp } from './helpers';

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
    });
    expect(new Date(body.time).toISOString()).toBe(body.time);
    expect(new Date(body.time).getTime()).toBeGreaterThanOrEqual(before);
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
