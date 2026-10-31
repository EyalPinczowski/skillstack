import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthAdminError, createSupabaseAuthAdmin } from '../src/modules/accounts/auth-admin';
import { FAKE_SERVICE_KEY, startFakeSupabase, type FakeSupabase } from './fake-supabase';

const A = '11111111-1111-4111-8111-111111111111';

describe('Supabase AuthAdmin (local fake HTTP server)', () => {
  let fake: FakeSupabase;
  beforeAll(async () => {
    fake = await startFakeSupabase();
  });
  afterAll(async () => {
    await fake.close();
  });
  beforeEach(() => {
    fake.requests.length = 0;
    fake.status = 200;
    fake.hang = false;
    delete fake.respond;
  });

  const admin = (overrides: { timeoutMs?: number; serviceRoleKey?: string } = {}) =>
    createSupabaseAuthAdmin({
      baseUrl: `${fake.baseUrl}/`,
      serviceRoleKey: FAKE_SERVICE_KEY,
      ...overrides,
    });

  it('sends one DELETE to the admin endpoint with the key in apikey and Authorization', async () => {
    await admin().deleteUser(A);
    expect(fake.requests).toHaveLength(1);
    const [req] = fake.requests;
    expect(req!.method).toBe('DELETE');
    expect(req!.url).toBe(`/auth/v1/admin/users/${A}`);
    expect(req!.headers.apikey).toBe(FAKE_SERVICE_KEY);
    expect(req!.headers.authorization).toBe(`Bearer ${FAKE_SERVICE_KEY}`);
  });

  it('sends only apikey for a non-JWT secret key', async () => {
    await admin({ serviceRoleKey: 'sb_secret_fake_key_for_tests_0000' }).deleteUser(A);
    expect(fake.requests[0]!.headers.apikey).toBe('sb_secret_fake_key_for_tests_0000');
    expect(fake.requests[0]!.headers.authorization).toBeUndefined();
  });

  it('treats 404 (user already gone) as success', async () => {
    fake.status = 404;
    await expect(admin().deleteUser(A)).resolves.toBeUndefined();
  });

  it.each([401, 403, 429, 500, 503, 302])(
    'fails on %i with a message that has neither the key nor the body',
    async (status) => {
      fake.status = status;
      const error = await admin()
        .deleteUser(A)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AuthAdminError);
      const text = JSON.stringify([(error as Error).message, (error as Error).stack ?? '']);
      expect(text).not.toContain(FAKE_SERVICE_KEY);
      expect(text).not.toContain('fake response');
      expect((error as AuthAdminError).status).toBe(status);
    },
  );

  it('times out instead of hanging, and the error has no key or URL', async () => {
    fake.hang = true;
    const error = await admin({ timeoutMs: 150 })
      .deleteUser(A)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthAdminError);
    expect((error as Error).message).not.toContain(FAKE_SERVICE_KEY);
    expect((error as Error).message).not.toContain('127.0.0.1');
  });

  it('reports a connection failure without the URL', async () => {
    const dead = createSupabaseAuthAdmin({
      baseUrl: 'http://127.0.0.1:1',
      serviceRoleKey: FAKE_SERVICE_KEY,
      timeoutMs: 1000,
    });
    const error = await dead.deleteUser(A).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthAdminError);
    expect((error as Error).message).not.toContain('127.0.0.1');
  });

  it.each(['', 'not-a-uuid', `${A}/../x`, `${A}?x=1`, '../admin'])(
    'refuses %j without sending anything',
    async (id) => {
      await expect(admin().deleteUser(id)).rejects.toBeInstanceOf(AuthAdminError);
      expect(fake.requests).toHaveLength(0);
    },
  );
});
