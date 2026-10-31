import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startAuthServer } from './support/auth-server';
import { prepareDatabase } from './support/db';
import {
  API_PORT,
  API_URL,
  AUTH_PORT,
  E2E_NOW,
  REPO_ROOT,
  WEB_PORT,
  WORKER_ENV,
  requireEnv,
} from './support/env';
import { runToCompletion, startService, stopService, waitForHttp } from './support/processes';

/**
 * Brings up the real stack for the run, with nothing outside this machine:
 *   throwaway Postgres (rnd schema, real migrations) -> local JWKS server (keys made now)
 *   -> the built API with E2E_NOW -> the e2e web build served by `vite preview`.
 * Everything secret (signing key, database passwords, certificate) is generated here, lives in
 * memory or in a temporary folder, and is deleted at the end. Returns the teardown function.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const adminUrl = requireEnv('TEST_DATABASE_URL');
  const superuserUrl = requireEnv('TEST_SUPERUSER_URL');
  const dir = mkdtempSync(join(tmpdir(), 'skillstack-e2e-'));
  const services: ReturnType<typeof startService>[] = [];
  let auth: Awaited<ReturnType<typeof startAuthServer>> | undefined;

  const teardown = async () => {
    services.forEach(stopService);
    await auth?.close();
    rmSync(dir, { recursive: true, force: true });
  };

  try {
    const apiDatabaseUrl = await prepareDatabase(adminUrl, superuserUrl);
    auth = await startAuthServer(AUTH_PORT, dir);

    process.env[WORKER_ENV.signingKey] = JSON.stringify(auth.privateJwk);
    process.env[WORKER_ENV.issuer] = auth.issuer;
    process.env[WORKER_ENV.superuserUrl] = superuserUrl;

    // What the child processes inherit: no database admin URLs and no signing key.
    const base: NodeJS.ProcessEnv = { ...process.env };
    for (const name of ['TEST_DATABASE_URL', 'TEST_SUPERUSER_URL', ...Object.values(WORKER_ENV)]) {
      delete base[name];
    }
    await runToCompletion('api-build', dir, 'pnpm', ['--filter', '@skillstack/api', 'build'], {
      cwd: REPO_ROOT,
      env: base,
    });
    const api = startService('api', dir, 'node', ['apps/api/dist/server.js'], {
      cwd: REPO_ROOT,
      env: {
        ...base,
        // Not production: E2E_NOW is ignored there (apps/api/src/test-clock.ts).
        NODE_ENV: 'test',
        APP_ENV: 'rnd',
        HOST: '127.0.0.1',
        PORT: String(API_PORT),
        LOG_LEVEL: 'warn',
        DATABASE_URL: apiDatabaseUrl,
        SUPABASE_JWKS_URL: auth.jwksUrl,
        SUPABASE_JWT_ISSUER: auth.issuer,
        NODE_EXTRA_CA_CERTS: auth.certFile,
        CORS_ORIGINS: `http://127.0.0.1:${WEB_PORT}`,
        RATE_LIMIT_PER_MINUTE: '100000',
        E2E_NOW,
      },
    });
    services.push(api);

    // The e2e build of the web app: VITE_E2E=1 turns on the localStorage sign-in, and the fake
    // Supabase address is never contacted. Built into the temporary folder, not into the repo.
    const webDir = join(dir, 'web');
    const webEnv = {
      ...base,
      VITE_E2E: '1',
      VITE_APP_ENV: 'rnd',
      VITE_API_URL: API_URL,
      VITE_SUPABASE_URL: 'http://127.0.0.1:1',
      VITE_SUPABASE_ANON_KEY: 'e2e-not-a-real-key',
    };
    const vite = join(REPO_ROOT, 'apps/web/node_modules/vite/bin/vite.js');
    await runToCompletion(
      'web-build',
      dir,
      'node',
      [vite, 'build', '--outDir', webDir, '--emptyOutDir'],
      { cwd: join(REPO_ROOT, 'apps/web'), env: webEnv },
    );
    const web = startService(
      'web',
      dir,
      'node',
      [
        vite,
        'preview',
        '--host',
        '127.0.0.1',
        '--port',
        String(WEB_PORT),
        '--strictPort',
        '--outDir',
        webDir,
      ],
      { cwd: join(REPO_ROOT, 'apps/web'), env: webEnv },
    );
    services.push(web);

    await waitForHttp(`${API_URL}/api/v1/health`, api);
    await waitForHttp(`http://127.0.0.1:${WEB_PORT}/`, web);
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}
