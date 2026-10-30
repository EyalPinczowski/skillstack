import type { FastifyInstance } from 'fastify';

/**
 * Cheap headers for every response. No CSP yet: Swagger UI needs a tuned policy, so that is a
 * follow-up rather than a copied helmet default.
 */
export function installSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
  });
}
