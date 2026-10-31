import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Settings shared by the Playwright config, the global setup and the tests. TEST INFRASTRUCTURE. */

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const port = (name: string, fallback: number) => Number(process.env[name] ?? fallback);
export const API_PORT = port('E2E_API_PORT', 4310);
export const WEB_PORT = port('E2E_WEB_PORT', 4311);
export const AUTH_PORT = port('E2E_AUTH_PORT', 4312);

export const API_URL = `http://127.0.0.1:${API_PORT}`;
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

/**
 * The fixed "now" of the API (TEST-ONLY E2E_NOW): Monday 2026-11-02, 10:00 in Jerusalem, which is
 * inside the demo plan's study window. Every run sees the same plan-local day.
 */
export const E2E_NOW = '2026-11-02T08:00:00Z';
export const E2E_TODAY = '2026-11-02';
export const E2E_TIME_ZONE = 'Asia/Jerusalem';

/** Variables the global setup publishes to the test workers (it is the only writer). */
export const WORKER_ENV = {
  signingKey: 'E2E_SIGNING_JWK',
  issuer: 'E2E_ISSUER',
  superuserUrl: 'E2E_SUPERUSER_URL',
} as const;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See e2e/README.md.`);
  return value;
}
