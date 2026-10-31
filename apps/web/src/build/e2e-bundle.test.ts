// @vitest-environment node
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The end-to-end build swaps the sign-in for a token read from localStorage (src/e2e/). That must
 * never reach a real bundle. This test runs the real production build twice and reads the output:
 * the normal build has none of the test-only code, the VITE_E2E=1 build does (so the check can
 * really fail), and the e2e flag cannot be combined with the operational environment.
 */
const MARKERS = ['skillstack.e2e.access-token', '__E2E__', 'E2E_TOKEN_KEY'];
const FAKE_ENV = {
  VITE_APP_ENV: 'rnd',
  VITE_API_URL: 'http://127.0.0.1:4310',
  VITE_SUPABASE_URL: 'http://127.0.0.1:1',
  VITE_SUPABASE_ANON_KEY: 'not-a-real-key',
};

const outDirs: string[] = [];

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)])),
  );
  return nested.flat();
}

async function buildWith(extra: Record<string, string>) {
  const outDir = await mkdtemp(join(tmpdir(), 'skillstack-web-build-'));
  outDirs.push(outDir);
  const saved = { ...process.env };
  delete process.env.VITE_E2E;
  Object.assign(process.env, FAKE_ENV, extra);
  try {
    await build({
      root: process.cwd(),
      mode: 'production',
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true },
    });
  } finally {
    process.env = saved;
  }
  const files = await filesUnder(outDir);
  const text = (
    await Promise.all(
      files
        .filter((f) => /\.(js|html|css|map|json|webmanifest)$/.test(f))
        .map((f) => readFile(f, 'utf8')),
    )
  ).join('\n');
  return { files, text };
}

afterAll(async () => {
  await Promise.all(outDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('the test-only e2e sign-in', () => {
  it('is not in a normal production bundle', async () => {
    const { files, text } = await buildWith({});
    for (const marker of MARKERS) expect(text, marker).not.toContain(marker);
    expect(files.filter((f) => f.toLowerCase().includes('e2e'))).toEqual([]);
  }, 180_000);

  it('is not in the bundle when VITE_E2E is anything but 1', async () => {
    const { text } = await buildWith({ VITE_E2E: 'true' });
    for (const marker of MARKERS) expect(text, marker).not.toContain(marker);
  }, 180_000);

  it('is in the VITE_E2E=1 bundle, so the checks above can fail', async () => {
    const { text } = await buildWith({ VITE_E2E: '1' });
    expect(text).toContain('skillstack.e2e.access-token');
  }, 180_000);

  it('refuses to build with VITE_E2E=1 for the operational environment', async () => {
    await expect(buildWith({ VITE_E2E: '1', VITE_APP_ENV: 'operational' })).rejects.toThrow(
      /VITE_E2E=1/,
    );
  }, 180_000);
});
