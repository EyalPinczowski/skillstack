import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { join } from 'node:path';
import { exportJWK, generateKeyPair, type JWK } from 'jose';

/**
 * TEST-ONLY stand-in for Supabase Auth's key endpoint. It serves a JWKS (public key only) over
 * HTTPS, because the API only accepts an https JWKS URL. The key pair and the self-signed
 * certificate are generated on every run, kept in a temporary folder and never committed. The API
 * trusts the certificate through NODE_EXTRA_CA_CERTS (set by the global setup).
 */
export interface AuthServer {
  jwksUrl: string;
  issuer: string;
  /** PEM file of the self-signed certificate, for NODE_EXTRA_CA_CERTS. */
  certFile: string;
  /** The private signing key as a JWK. Handed to the token issuer (support/tokens.ts) only. */
  privateJwk: JWK;
  close(): Promise<void>;
}

export const KEY_ID = 'e2e-key';

export async function startAuthServer(port: number, dir: string): Promise<AuthServer> {
  const certFile = join(dir, 'auth-cert.pem');
  const keyFile = join(dir, 'auth-key.pem');
  execFileSync(
    'openssl',
    [
      ...['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes'],
      ...['-keyout', keyFile, '-out', certFile, '-days', '1', '-subj', '/CN=127.0.0.1'],
      ...['-addext', 'subjectAltName=IP:127.0.0.1'],
    ],
    { stdio: 'ignore' },
  );

  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const publicJwk: JWK = { ...(await exportJWK(publicKey)), kid: KEY_ID, alg: 'ES256', use: 'sig' };
  const privateJwk: JWK = { ...(await exportJWK(privateKey)), kid: KEY_ID, alg: 'ES256' };
  const body = JSON.stringify({ keys: [publicJwk] });

  const server: Server = createServer(
    { cert: readFileSync(certFile), key: readFileSync(keyFile) },
    (req, res) => {
      if (req.url === '/auth/v1/.well-known/jwks.json') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(body);
      } else {
        res.writeHead(404).end();
      }
    },
  );
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  const origin = `https://127.0.0.1:${port}`;
  return {
    jwksUrl: `${origin}/auth/v1/.well-known/jwks.json`,
    issuer: `${origin}/auth/v1`,
    certFile,
    privateJwk,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
