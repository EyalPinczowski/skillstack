import { exportJWK, generateKeyPair, SignJWT, type JWK, type JWTVerifyGetKey } from 'jose';
import { createLocalJWKSet } from 'jose';

export const ISSUER = 'https://test-project.example.test/auth/v1';
export const AUDIENCE = 'authenticated';

export interface TestKeys {
  /** The public key set the verifier trusts, built locally (never fetched from a network). */
  keys: JWTVerifyGetKey;
  sign(options?: SignOptions): Promise<string>;
}

export interface SignOptions {
  sub?: string | null;
  email?: string | null;
  iss?: string;
  aud?: string;
  /** Seconds from now; negative means already expired. */
  expiresIn?: number;
  alg?: 'ES256' | 'RS256';
  /** Sign with some other key (a bad signature for the trusted key set). */
  otherKey?: boolean;
}

/** Locally generated signing keys. Nothing here is a real credential. */
export async function makeTestKeys(): Promise<TestKeys> {
  const trusted = await generateKeyPair('ES256');
  const other = await generateKeyPair('ES256');
  const rsa = await generateKeyPair('RS256');
  const jwk = async (publicKey: Parameters<typeof exportJWK>[0], kid: string, alg: string) =>
    ({ ...(await exportJWK(publicKey)), kid, alg, use: 'sig' }) satisfies JWK;
  const keys = createLocalJWKSet({
    keys: [await jwk(trusted.publicKey, 'es', 'ES256'), await jwk(rsa.publicKey, 'rs', 'RS256')],
  });

  async function sign(o: SignOptions = {}): Promise<string> {
    const alg = o.alg ?? 'ES256';
    const claims: Record<string, unknown> = {};
    if (o.email !== null) claims.email = o.email ?? 'user@example.com';
    const jwt = new SignJWT(claims)
      .setProtectedHeader({ alg, kid: alg === 'ES256' ? 'es' : 'rs' })
      .setIssuer(o.iss ?? ISSUER)
      .setAudience(o.aud ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + (o.expiresIn ?? 3600));
    if (o.sub !== null) jwt.setSubject(o.sub ?? '11111111-1111-4111-8111-111111111111');
    const key = o.otherKey
      ? other.privateKey
      : alg === 'ES256'
        ? trusted.privateKey
        : rsa.privateKey;
    return jwt.sign(key);
  }

  return { keys, sign };
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** An unsigned token with alg "none", the classic forgery. */
export function unsignedToken(sub = '11111111-1111-4111-8111-111111111111'): string {
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    sub,
    iss: ISSUER,
    aud: AUDIENCE,
    exp: now + 3600,
    email: 'user@example.com',
  })}.`;
}
