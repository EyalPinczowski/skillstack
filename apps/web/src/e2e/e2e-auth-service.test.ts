import { describe, expect, it, vi } from 'vitest';
import { AuthFailure } from '../auth/auth-service';
import { createE2EAuthService, E2E_TOKEN_KEY } from './e2e-auth-service';

const b64 = (value: unknown) => btoa(JSON.stringify(value)).replaceAll('=', '');
const token = (claims: unknown) => `${b64({ alg: 'ES256' })}.${b64(claims)}.signature`;

describe('the test-only e2e AuthService', () => {
  it('is signed out without a token', async () => {
    localStorage.clear();
    const auth = createE2EAuthService();
    expect(await auth.getSession()).toBeNull();
    expect(await auth.getAccessToken()).toBeNull();
  });

  it('reads who is signed in from the token in localStorage', async () => {
    const value = token({ sub: 'user-1', email: 'a@example.test' });
    localStorage.setItem(E2E_TOKEN_KEY, value);
    const auth = createE2EAuthService();
    expect(await auth.getSession()).toEqual({ userId: 'user-1', email: 'a@example.test' });
    expect(await auth.getAccessToken()).toBe(value);
  });

  it('treats a token it cannot read as signed out', async () => {
    localStorage.setItem(E2E_TOKEN_KEY, 'not-a-token');
    const auth = createE2EAuthService();
    expect(await auth.getSession()).toBeNull();
    expect(await auth.getAccessToken()).toBeNull();
  });

  it('signs out by removing the token and tells the listeners', async () => {
    localStorage.setItem(E2E_TOKEN_KEY, token({ sub: 'user-1' }));
    const auth = createE2EAuthService();
    const seen = vi.fn();
    const stop = auth.onChange(seen);
    await auth.signOut('local');
    expect(localStorage.getItem(E2E_TOKEN_KEY)).toBeNull();
    expect(seen).toHaveBeenCalledWith(null);
    stop();
  });

  it('has no other way to sign in', async () => {
    const auth = createE2EAuthService();
    await expect(auth.sendCode('a@example.test')).rejects.toBeInstanceOf(AuthFailure);
    await expect(auth.verifyCode('a@example.test', '123456')).rejects.toBeInstanceOf(AuthFailure);
    await expect(auth.signInWithGoogle()).rejects.toBeInstanceOf(AuthFailure);
  });
});
