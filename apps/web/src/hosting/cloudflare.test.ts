import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const webRoot = resolve(__dirname, '../..');
const repoRoot = resolve(webRoot, '../..');

type Header = { key: string; value: string };

function readVercelHeaders(): Header[] {
  const config = JSON.parse(readFileSync(resolve(repoRoot, 'vercel.json'), 'utf8')) as {
    headers: { source: string; headers: Header[] }[];
  };
  const all = config.headers.find((rule) => rule.source === '/(.*)');
  if (!all) throw new Error('vercel.json has no catch-all header rule');
  return all.headers;
}

/** Parses the rules of a Cloudflare `_headers` file into path -> header map. */
function parseHeadersFile(text: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = new Map();
      rules.set(line.trim(), current);
    } else if (current) {
      const index = line.indexOf(':');
      current.set(line.slice(0, index).trim(), line.slice(index + 1).trim());
    }
  }
  return rules;
}

describe('Cloudflare hosting files', () => {
  const headersFile = resolve(webRoot, 'public/_headers');
  const rules = parseHeadersFile(readFileSync(headersFile, 'utf8'));
  const catchAll = rules.get('/*');

  it('has a catch-all rule', () => {
    expect(catchAll).toBeDefined();
  });

  it('repeats every header from vercel.json with the same value', () => {
    for (const { key, value } of readVercelHeaders()) {
      expect(catchAll?.get(key), key).toBe(value);
    }
  });

  it('forbids framing with a CSP frame-ancestors header', () => {
    expect(catchAll?.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
  });

  it('has no other header than vercel.json plus the CSP frame-ancestors', () => {
    const expected = new Set([...readVercelHeaders().map((h) => h.key), 'Content-Security-Policy']);
    expect(new Set(catchAll?.keys())).toEqual(expected);
  });

  it('configures the SPA fallback and serves the web build output', () => {
    const wrangler = readFileSync(resolve(repoRoot, 'wrangler.jsonc'), 'utf8');
    expect(wrangler).toMatch(/"not_found_handling":\s*"single-page-application"/);
    expect(wrangler).toMatch(/"directory":\s*"\.\/apps\/web\/dist"/);
    expect(wrangler).not.toMatch(/"main"\s*:/);
  });

  it('lives in public/, which Vite copies into dist (public dir not disabled)', () => {
    expect(existsSync(headersFile)).toBe(true);
    const viteConfig = readFileSync(resolve(webRoot, 'vite.config.ts'), 'utf8');
    expect(viteConfig).not.toMatch(/publicDir\s*:/);
  });
});
