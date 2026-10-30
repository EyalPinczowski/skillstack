/**
 * Writes the API's OpenAPI document to a file (or stdout), so the web app can generate its typed
 * client from the real contract. Builds the app with fake collaborators: no database, no network,
 * no secrets. Usage: pnpm --filter @skillstack/api openapi:dump [--out <file>]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { rejectAllVerifier } from '../src/modules/accounts/token-verifier';

export async function buildOpenApiDocument(): Promise<string> {
  const app = buildApp(loadConfig({ LOG_LEVEL: 'silent' }), {
    verifier: rejectAllVerifier,
    db: null,
  });
  try {
    await app.ready();
    return `${JSON.stringify(app.swagger(), null, 2)}\n`;
  } finally {
    await app.close();
  }
}

async function main() {
  const flag = process.argv.indexOf('--out');
  const out = flag === -1 ? undefined : process.argv[flag + 1];
  if (flag !== -1 && !out) throw new Error('--out needs a file path');
  const json = await buildOpenApiDocument();
  if (out) {
    const file = resolve(process.cwd(), out);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, json);
  } else {
    process.stdout.write(json);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
