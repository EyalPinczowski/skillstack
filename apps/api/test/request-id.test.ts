import { describe, expect, it } from 'vitest';
import { generateRequestId } from '../src/plugins/request-id';
import { testApp } from './helpers';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function healthWith(headers: Record<string, string>) {
  const app = testApp();
  const res = await app.inject({ method: 'GET', url: '/api/v1/health', headers });
  await app.close();
  return res;
}

describe('request id', () => {
  it('echoes a valid incoming id', async () => {
    const res = await healthWith({ 'x-request-id': 'client-abc_1.2' });
    expect(res.headers['x-request-id']).toBe('client-abc_1.2');
  });

  it('generates a UUID when none is sent', async () => {
    const res = await healthWith({});
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it.each([
    ['characters outside the allowed set', 'bad id; drop table'],
    ['more than 64 characters', 'a'.repeat(65)],
  ])('replaces an incoming id with %s', async (_label, value) => {
    const res = await healthWith({ 'x-request-id': value });
    expect(res.headers['x-request-id']).not.toBe(value);
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('accepts exactly 64 characters', () => {
    const id = 'a'.repeat(64);
    expect(generateRequestId({ headers: { 'x-request-id': id } })).toBe(id);
  });

  it('puts the same id in error bodies', async () => {
    const app = testApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/nope',
      headers: { 'x-request-id': 'trace-me' },
    });
    await app.close();
    expect(res.json().error.requestId).toBe('trace-me');
  });
});
