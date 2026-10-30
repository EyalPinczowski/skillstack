import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { AuthFailure, createSupabaseAuthService } from './auth-service';

/** The few Supabase auth calls the adapter uses, as spies. */
function fakeSupabase() {
  const unsubscribe = vi.fn();
  let listener: ((event: string, session: unknown) => void) | undefined;
  const auth = {
    getSession: vi.fn(async () => ({
      data: { session: { access_token: 'tok', user: { id: 'u1', email: 'dana@example.com' } } },
    })),
    onAuthStateChange: vi.fn((cb: typeof listener) => {
      listener = cb;
      return { data: { subscription: { unsubscribe } } };
    }),
    signInWithOtp: vi.fn<(args: unknown) => Promise<{ error: unknown }>>(async () => ({
      error: null,
    })),
    verifyOtp: vi.fn<(args: unknown) => Promise<{ error: unknown }>>(async () => ({ error: null })),
    signInWithOAuth: vi.fn<(args: unknown) => Promise<{ error: unknown }>>(async () => ({
      error: null,
    })),
    signOut: vi.fn<(args: unknown) => Promise<{ error: unknown }>>(async () => ({ error: null })),
  };
  const service = createSupabaseAuthService({ auth } as unknown as SupabaseClient);
  return { auth, service, unsubscribe, emit: (s: unknown) => listener?.('SIGNED_IN', s) };
}

describe('supabase auth adapter', () => {
  it('exposes only the user id and email, and the token on request', async () => {
    const { service } = fakeSupabase();
    await expect(service.getSession()).resolves.toEqual({
      userId: 'u1',
      email: 'dana@example.com',
    });
    await expect(service.getAccessToken()).resolves.toBe('tok');
  });

  it('returns null when there is no session', async () => {
    const { auth, service } = fakeSupabase();
    auth.getSession.mockResolvedValueOnce({ data: { session: null } } as never);
    await expect(service.getSession()).resolves.toBeNull();
    auth.getSession.mockResolvedValueOnce({ data: { session: null } } as never);
    await expect(service.getAccessToken()).resolves.toBeNull();
  });

  it('forwards auth state changes and unsubscribes', () => {
    const { service, emit, unsubscribe } = fakeSupabase();
    const seen = vi.fn();
    const stop = service.onChange(seen);
    emit({ user: { id: 'u2', email: null }, access_token: 'x' });
    emit(null);
    expect(seen).toHaveBeenNthCalledWith(1, { userId: 'u2', email: null });
    expect(seen).toHaveBeenNthCalledWith(2, null);
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('asks for an email one-time code and passes the captcha token seam through', async () => {
    const { auth, service } = fakeSupabase();
    await service.sendCode('dana@example.com');
    await service.sendCode('dana@example.com', { captchaToken: 'cap' });
    expect(auth.signInWithOtp).toHaveBeenNthCalledWith(1, {
      email: 'dana@example.com',
      options: { shouldCreateUser: true, captchaToken: undefined },
    });
    expect(auth.signInWithOtp).toHaveBeenNthCalledWith(2, {
      email: 'dana@example.com',
      options: { shouldCreateUser: true, captchaToken: 'cap' },
    });
  });

  it('verifies the code as an email OTP', async () => {
    const { auth, service } = fakeSupabase();
    await service.verifyCode('dana@example.com', '123456');
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'dana@example.com',
      token: '123456',
      type: 'email',
    });
  });

  it('starts Google sign-in and returns to this origin', async () => {
    const { auth, service } = fakeSupabase();
    await service.signInWithGoogle();
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  });

  it.each(['local', 'global'] as const)('signs out with scope %s', async (scope) => {
    const { auth, service } = fakeSupabase();
    await service.signOut(scope);
    expect(auth.signOut).toHaveBeenCalledWith({ scope });
  });

  it('maps library errors to a kind the UI can word, without leaking their text', async () => {
    const { auth, service } = fakeSupabase();
    auth.signInWithOtp.mockResolvedValueOnce({ error: { status: 429, message: 'secret detail' } });
    await expect(service.sendCode('a@b.co')).rejects.toMatchObject({ kind: 'rate_limited' });

    auth.signInWithOtp.mockResolvedValueOnce({
      error: { name: 'AuthRetryableFetchError', status: 0, message: 'x' },
    });
    await expect(service.sendCode('a@b.co')).rejects.toMatchObject({ kind: 'network' });

    auth.signInWithOtp.mockResolvedValueOnce({
      error: { status: 422, message: 'Signups not allowed' },
    });
    const error = await service.sendCode('a@b.co').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthFailure);
    expect((error as AuthFailure).kind).toBe('failed');
    expect((error as AuthFailure).message).not.toContain('Signups');

    auth.verifyOtp.mockResolvedValueOnce({ error: { status: 403, message: 'expired' } });
    await expect(service.verifyCode('a@b.co', '111111')).rejects.toMatchObject({
      kind: 'invalid_code',
    });
  });
});
