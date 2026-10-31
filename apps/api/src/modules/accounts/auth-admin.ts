/** Deletes users in Supabase Auth. Needs the service-role key, so it exists only on the server. */
export interface AuthAdmin {
  /** Resolves when the Auth user is gone (an already-missing user counts). Throws AuthAdminError. */
  deleteUser(userId: string): Promise<void>;
}

/** Never carries the key, the URL or a response body: the message is fixed text and a status. */
export class AuthAdminError extends Error {
  constructor(
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'AuthAdminError';
  }
}

/** Used when no service key is configured (development, tests): deletion fails closed. */
export const unconfiguredAuthAdmin: AuthAdmin = {
  async deleteUser() {
    throw new AuthAdminError('Supabase Auth admin access is not configured');
  },
};

/**
 * R&D: the Auth project is shared with the live app, so the R&D API never touches it. Deleting an
 * R&D account removes R&D data only; the sign-in record and the Operational data stay. This is a
 * deliberate "nothing to do here", not a failure, and it makes no network call at all.
 */
export const noopAuthAdminForRnd: AuthAdmin = {
  async deleteUser() {
    // Intentionally empty (see above).
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_TIMEOUT_MS = 8000;

/** A key that is already a JWT (legacy service_role key); new `sb_secret_` keys are not JWTs. */
const looksLikeJwt = (key: string) => key.startsWith('eyJ') && key.split('.').length === 3;

/**
 * Supabase Admin API: DELETE {baseUrl}/auth/v1/admin/users/{id} with the key in `apikey`.
 * A hard delete (no body, so the default `should_soft_delete=false`). 404 means the user is
 * already gone, which is the state we want, so it is success and makes a retry safe.
 */
export function createSupabaseAuthAdmin(options: {
  baseUrl: string;
  serviceRoleKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): AuthAdmin {
  const base = options.baseUrl.replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? fetch;
  const key = options.serviceRoleKey;
  return {
    async deleteUser(userId) {
      // Only a UUID can reach the URL path, so the id cannot change the endpoint.
      if (!UUID.test(userId)) throw new AuthAdminError('invalid user id');
      let res: Response;
      try {
        res = await doFetch(`${base}/auth/v1/admin/users/${userId}`, {
          method: 'DELETE',
          headers: {
            apikey: key,
            // Needs check: for the new non-JWT secret keys Supabase says not to use Bearer.
            ...(looksLikeJwt(key) ? { authorization: `Bearer ${key}` } : {}),
          },
          redirect: 'manual',
          signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
      } catch (error) {
        // The error text can hold the URL; keep only its kind (TimeoutError, TypeError, ...).
        const kind = error instanceof Error ? error.name : 'error';
        throw new AuthAdminError(`Supabase Auth admin request failed (${kind})`);
      }
      // Release the connection; the body is never read into a message.
      await res.body?.cancel().catch(() => undefined);
      if (res.status === 404 || (res.status >= 200 && res.status < 300)) return;
      throw new AuthAdminError(`Supabase Auth admin returned HTTP ${res.status}`, res.status);
    },
  };
}
