import type { FastifyInstance } from 'fastify';

/**
 * The API serves JSON only, so by default a browser may load nothing from it and may not frame
 * it. The Swagger UI sets its own policy (see `transformSwaggerCsp`), which this hook keeps.
 */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";

/**
 * Hash of the one `<style>` element swagger-ui-bundle.js inserts at run time (found with Chromium:
 * without it the console shows a CSP violation). It belongs to @fastify/swagger-ui 6.1.2; after an
 * upgrade the console may report a new hash, which is cosmetic only. Update it from that message.
 */
const SWAGGER_UI_STYLE_HASH = "'sha256-RL3ie0nH+Lzz2YNqQN83mnU0J1ot4QL7b99vMdIX99w='";

/**
 * Turns the Swagger UI's own policy (scripts and styles allowed by hash) into ours: no framing,
 * and no `upgrade-insecure-requests`, which would break the docs on http://localhost. Scripts and
 * styles never get 'unsafe-inline'.
 */
export function transformSwaggerCsp(header: unknown): string {
  return String(header)
    .split(';')
    .map((directive) => directive.trim())
    .filter((directive) => directive !== '' && directive !== 'upgrade-insecure-requests')
    .map((directive) =>
      directive.startsWith('frame-ancestors ') ? "frame-ancestors 'none'" : directive,
    )
    .map((directive) =>
      directive.startsWith('style-src ') ? `${directive} ${SWAGGER_UI_STYLE_HASH}` : directive,
    )
    .join('; ');
}

/** Cheap headers for every response. */
export function installSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    // Hooks of this scope run before the Swagger UI's, which then replaces this for its own files.
    reply.header('content-security-policy', API_CSP);
  });
}
