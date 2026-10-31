import type { Plugin } from 'vite';

/**
 * Content-Security-Policy for the web app (v0.1 review finding 3).
 *
 * The session lives in localStorage, so a script injection would mean account takeover. The policy
 * allows only our own files plus the two origins the app talks to. `vercel.json` is static, so
 * the API and Supabase origins (set per Vercel environment) are put into a CSP meta tag when the
 * app is built. `frame-ancestors` cannot be set in a meta tag; `vercel.json` sends it as a header.
 */
export interface CspOrigins {
  /** VITE_API_URL. Falls back to the same local default as src/env.ts. */
  apiUrl?: string;
  /** VITE_SUPABASE_URL. Left out when empty (the app then refuses to start anyway). */
  supabaseUrl?: string;
}

export const DEFAULT_API_URL = 'http://localhost:3000';

function originOf(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL, so the CSP cannot be built.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${name} must be an http: or https: URL.`);
  }
  return url.origin;
}

export function buildCsp({ apiUrl, supabaseUrl }: CspOrigins): string {
  const connect = ["'self'"];
  for (const [name, value] of [
    ['VITE_API_URL', apiUrl?.trim() || DEFAULT_API_URL],
    ['VITE_SUPABASE_URL', supabaseUrl?.trim()],
  ] as const) {
    if (!value) continue;
    const origin = originOf(name, value);
    if (!connect.includes(origin)) connect.push(origin);
  }
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    `connect-src ${connect.join(' ')}`,
    "img-src 'self' data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

/** Adds the CSP meta tag to index.html in production builds only (dev needs inline HMR code). */
export function cspMetaPlugin(origins: CspOrigins): Plugin {
  return {
    name: 'skillstack-csp-meta',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: buildCsp(origins) },
        injectTo: 'head-prepend',
      },
    ],
  };
}
