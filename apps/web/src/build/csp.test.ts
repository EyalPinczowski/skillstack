// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';
import { buildCsp } from './csp';

const webRoot = fileURLToPath(new URL('../..', import.meta.url));

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split('; ').map((part) => {
      const [name, ...values] = part.split(' ');
      return [name!, values] as const;
    }),
  );
}

describe('buildCsp', () => {
  it('allows only self, the API origin and the Supabase origin to be connected to', () => {
    const csp = directives(
      buildCsp({
        apiUrl: 'https://skillstack-api.onrender.com/',
        supabaseUrl: 'https://abcdefgh.supabase.co/auth/v1',
      }),
    );
    expect(csp.get('connect-src')).toEqual([
      "'self'",
      'https://skillstack-api.onrender.com',
      'https://abcdefgh.supabase.co',
    ]);
  });

  it('is restrictive everywhere else and has no unsafe-inline or unsafe-eval', () => {
    const text = buildCsp({ apiUrl: 'https://api.example.com', supabaseUrl: 'https://s.example' });
    const csp = directives(text);
    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect(csp.get('script-src')).toEqual(["'self'"]);
    expect(csp.get('style-src')).toEqual(["'self'"]);
    expect(csp.get('img-src')).toEqual(["'self'", 'data:']);
    expect(csp.get('font-src')).toEqual(["'self'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'self'"]);
    expect(csp.get('form-action')).toEqual(["'self'"]);
    expect(text).not.toContain('unsafe');
    // Ignored in a meta tag (and logged as a console error), so it is sent as a header instead.
    expect(csp.has('frame-ancestors')).toBe(false);
  });

  it('falls back to the local API default and skips an unset Supabase URL', () => {
    expect(directives(buildCsp({})).get('connect-src')).toEqual([
      "'self'",
      'http://localhost:3000',
    ]);
  });

  it('fails the build on a URL it cannot read, instead of silently widening the policy', () => {
    expect(() => buildCsp({ apiUrl: 'not a url' })).toThrow(/VITE_API_URL/);
    expect(() => buildCsp({ supabaseUrl: 'ftp://x.example' })).toThrow(/VITE_SUPABASE_URL/);
  });
});

describe('production build output', () => {
  let outDir = '';
  afterAll(async () => {
    if (outDir) await rm(outDir, { recursive: true, force: true });
  });

  it('puts the CSP meta tag, built from the environment, before any script in index.html', async () => {
    outDir = await mkdtemp(join(tmpdir(), 'skillstack-csp-'));
    const saved = { ...process.env };
    process.env.VITE_API_URL = 'https://api-under-test.example.com';
    process.env.VITE_SUPABASE_URL = 'https://projectref.supabase.co';
    try {
      await build({
        root: webRoot,
        mode: 'production',
        logLevel: 'silent',
        build: { outDir, emptyOutDir: true },
      });
    } finally {
      process.env = saved;
    }
    const html = await readFile(join(outDir, 'index.html'), 'utf8');
    const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
    expect(meta).not.toBeNull();
    expect(directives(meta![1]!.replaceAll('&#39;', "'")).get('connect-src')).toEqual([
      "'self'",
      'https://api-under-test.example.com',
      'https://projectref.supabase.co',
    ]);
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<script'));
    // The policy has no 'unsafe-inline', so the page must have no inline script or style.
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/);
    expect(html).not.toContain('<style');
    expect(html).not.toMatch(/\sstyle=/);
  }, 90_000);
});
