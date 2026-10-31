import { importJWK, SignJWT } from 'jose';
import { requireEnv, WORKER_ENV } from './env';
import { KEY_ID } from './auth-server';

/**
 * TEST-ONLY token issuer. Signs Supabase-shaped access tokens (ES256, audience "authenticated")
 * with the key pair that the global setup generated for this run. The API verifies them against
 * the local JWKS server exactly as it would verify Supabase's.
 */
export async function issueToken(user: { id: string; email: string }): Promise<string> {
  const jwk = JSON.parse(requireEnv(WORKER_ENV.signingKey));
  const key = await importJWK(jwk, 'ES256');
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'ES256', kid: KEY_ID })
    .setIssuer(requireEnv(WORKER_ENV.issuer))
    .setAudience('authenticated')
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
}
