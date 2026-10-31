import { AuthFailure, type AuthService, type AuthSession } from '../auth/auth-service';

/**
 * TEST-ONLY. An AuthService for the end-to-end build (VITE_E2E=1): it does not talk to Supabase
 * and does not verify anything. The test runner puts an access token into localStorage under
 * `E2E_TOKEN_KEY` and the API (which does verify it against a local key set) decides what it
 * means. This file is only reachable through `if (__E2E__)` in main.tsx, so a normal build drops
 * it; apps/web/src/build/e2e-bundle.test.ts proves that on a real production build.
 */
export const E2E_TOKEN_KEY = 'skillstack.e2e.access-token';

/** Reads the claims of a JWT without checking its signature: only to show who is signed in. */
function sessionOf(token: string | null): AuthSession | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1] ?? '';
    const padded = payload.replaceAll('-', '+').replaceAll('_', '/');
    const claims = JSON.parse(atob(padded)) as { sub?: unknown; email?: unknown };
    if (typeof claims.sub !== 'string') return null;
    return { userId: claims.sub, email: typeof claims.email === 'string' ? claims.email : null };
  } catch {
    return null;
  }
}

export function createE2EAuthService(storage: Storage = window.localStorage): AuthService {
  const listeners = new Set<(session: AuthSession | null) => void>();
  const read = () => storage.getItem(E2E_TOKEN_KEY);
  const notify = () => {
    const session = sessionOf(read());
    listeners.forEach((listener) => listener(session));
  };
  const refuse = (): never => {
    throw new AuthFailure('failed');
  };

  return {
    async getSession() {
      return sessionOf(read());
    },
    onChange(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    async getAccessToken() {
      return sessionOf(read()) ? read() : null;
    },
    async sendCode() {
      refuse();
    },
    async verifyCode() {
      refuse();
    },
    async signInWithGoogle() {
      refuse();
    },
    async signOut() {
      storage.removeItem(E2E_TOKEN_KEY);
      notify();
    },
  };
}
