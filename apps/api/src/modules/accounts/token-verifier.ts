import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/** What the API learns from a verified access token. The id is the only identity it trusts. */
export interface VerifiedToken {
  /** The `sub` claim: the Supabase Auth user id (a UUID). */
  userId: string;
  /** The `email` claim, lower-cased, or null when the token carries none. */
  email: string | null;
}

/** Any reason a token is not acceptable. The reason is for logs only, never for the client. */
export class InvalidTokenError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InvalidTokenError';
  }
}

export interface TokenVerifier {
  /** Resolves for a valid token, throws InvalidTokenError otherwise. */
  verify(token: string): Promise<VerifiedToken>;
}

/** A verifier that accepts nothing. Used when no sign-in configuration exists (fail closed). */
export const rejectAllVerifier: TokenVerifier = {
  async verify() {
    throw new InvalidTokenError('token verification is not configured');
  },
};

export interface SupabaseVerifierOptions {
  issuer: string;
  /** Resolves signing keys. Tests pass a local key set; production uses the project's JWKS URL. */
  keys: JWTVerifyGetKey;
}

/**
 * Asymmetric algorithms only. `none` and the shared-secret HS* family are never accepted: with
 * a public key set a HS256 token signed with the public key would otherwise be a known attack.
 * NEEDS CHECK: Supabase projects on the legacy HS256 secret publish no JWKS keys; they must
 * migrate to asymmetric signing keys (docs/setup/api-auth.md).
 */
const ALGORITHMS = ['ES256', 'RS256'];

/** Supabase's access-token audience. NEEDS CHECK against the live project (docs/setup/api-auth.md). */
export const SUPABASE_AUDIENCE = 'authenticated';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createSupabaseVerifier({ issuer, keys }: SupabaseVerifierOptions): TokenVerifier {
  return {
    async verify(token) {
      let payload;
      try {
        ({ payload } = await jwtVerify(token, keys, {
          issuer,
          audience: SUPABASE_AUDIENCE,
          algorithms: ALGORITHMS,
          requiredClaims: ['sub', 'exp', 'iss', 'aud'],
        }));
      } catch (error) {
        throw new InvalidTokenError(error instanceof Error ? error.name : 'verification failed');
      }
      const sub = payload.sub;
      if (typeof sub !== 'string' || !UUID.test(sub)) {
        throw new InvalidTokenError('sub is not a UUID');
      }
      const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : null;
      return { userId: sub.toLowerCase(), email: email || null };
    },
  };
}

/** The production verifier: keys come from the project's JWKS URL (cached and refreshed by jose). */
export function createSupabaseVerifierFromUrl(options: {
  jwksUrl: string;
  issuer: string;
}): TokenVerifier {
  return createSupabaseVerifier({
    issuer: options.issuer,
    keys: createRemoteJWKSet(new URL(options.jwksUrl), { timeoutDuration: 5000 }),
  });
}
