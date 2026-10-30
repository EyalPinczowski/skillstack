import { describe, expect, it } from 'vitest';
import { InMemoryIdempotencyStore } from '../src/plugins/idempotency';
import { testApp } from './helpers';

const KEY = '3b0f4b1e-6d47-4a5e-9d0a-5a2f0e8d7c11';

function appWithEcho() {
  const app = testApp();
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
});

describe('InMemoryIdempotencyStore', () => {
  it('returns what was stored, and nothing for unknown keys', async () => {
    const store = new InMemoryIdempotencyStore();
    expect(await store.get(KEY)).toBeUndefined();
    await store.set(KEY, { statusCode: 201, body: { id: 'x' } });
    expect(await store.get(KEY)).toEqual({ statusCode: 201, body: { id: 'x' } });
    expect(await store.get('other')).toBeUndefined();
  });
});
