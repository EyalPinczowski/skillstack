import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

/** What the UI knows about the signed-in person. Tokens never leave the service. */
export interface AuthSession {
  userId: string;
  email: string | null;
}

export type AuthFailureKind = 'rate_limited' | 'invalid_code' | 'network' | 'failed';

/** A sign-in problem with a kind the UI can turn into a safe message. */
export class AuthFailure extends Error {
  constructor(public readonly kind: AuthFailureKind) {
    super(kind);
    this.name = 'AuthFailure';
  }
}

export type SignOutScope = 'local' | 'global';

/**
 * Everything the app needs from Supabase Auth, behind one small interface so the UI and its tests
 * never touch the library. The Supabase implementation is `createSupabaseAuthService`.
 */
export interface AuthService {
  getSession(): Promise<AuthSession | null>;
  /** Calls back on sign-in, sign-out and user changes. Returns the unsubscribe function. */
  onChange(callback: (session: AuthSession | null) => void): () => void;
  /** The current access token, refreshed by the library when needed; null when signed out. */
  getAccessToken(): Promise<string | null>;
  /**
   * Emails a one-time code. `captchaToken` is the seam for Cloudflare Turnstile (spec 3.A): not
   * passed yet; once the widget exists, its token goes here and on to Supabase.
   */
  sendCode(email: string, options?: { captchaToken?: string }): Promise<void>;
  verifyCode(email: string, code: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signOut(scope: SignOutScope): Promise<void>;
}

const toSession = (session: Session | null): AuthSession | null =>
  session ? { userId: session.user.id, email: session.user.email ?? null } : null;

function failureFrom(error: { status?: number; name?: string }, fallback: AuthFailureKind) {
  if (error.status === 429) return new AuthFailure('rate_limited');
  if (error.name === 'AuthRetryableFetchError' || error.status === 0) {
    return new AuthFailure('network');
  }
  return new AuthFailure(fallback);
}

/** Wraps a Supabase client. Taking the client as a parameter lets tests pass a fake one. */
export function createSupabaseAuthService(supabase: SupabaseClient): AuthService {
  return {
    async getSession() {
      const { data } = await supabase.auth.getSession();
      return toSession(data.session);
    },

    onChange(callback) {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        callback(toSession(session));
      });
      return () => data.subscription.unsubscribe();
    },

    async getAccessToken() {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },

    async sendCode(email, options) {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        // Whether the email may join is decided by the API's allowlist, not here (spec 3.A).
        options: { shouldCreateUser: true, captchaToken: options?.captchaToken },
      });
      if (error) throw failureFrom(error, 'failed');
    },

    async verifyCode(email, code) {
      const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error) throw failureFrom(error, 'invalid_code');
    },

    async signInWithGoogle() {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) throw failureFrom(error, 'failed');
    },

    async signOut(scope) {
      // Needs check: what Supabase does with the other devices' access tokens after a global
      // sign-out (see docs/setup/api-auth.md).
      const { error } = await supabase.auth.signOut({ scope });
      if (error) throw failureFrom(error, 'failed');
    },
  };
}

/** The real client: the library persists the session, refreshes it and reads the OAuth redirect. */
export function createBrowserAuthService(config: { supabaseUrl: string; supabaseAnonKey: string }) {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });
  return createSupabaseAuthService(supabase);
}
