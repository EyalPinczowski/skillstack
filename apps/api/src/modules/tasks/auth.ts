import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '../../db/database';
import { ProvisionDeniedError } from '../../db/database';
import { HttpError } from '../../errors';
import { InvalidTokenError, type TokenVerifier } from '../accounts/token-verifier';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the account guard: the user id comes only from the verified token's `sub`. */
    accountId?: string;
  }
}

const unauthorized = () => new HttpError(401, 'unauthorized', 'Authentication is required.');
const forbidden = () => new HttpError(403, 'forbidden', 'This account cannot use Skillstack.');

/** A bearer token of token characters only: a linear check, no backtracking on user input. */
function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length);
  return /^[A-Za-z0-9._~+/=-]+$/.test(token) ? token : null;
}

/**
 * Verifies the token, checks the account is active and sets `request.accountId` from `sub`.
 * Same rules and the same answers as the account routes (generic 403 for every refusal).
 */
export function installAccountGuard(
  app: FastifyInstance,
  { verifier, db }: { verifier: TokenVerifier; db: Database | null },
): void {
  app.decorateRequest('accountId', undefined);
  app.addHook('onRequest', async (request) => {
    const token = bearerToken(request);
    if (!token) throw unauthorized();
    let verified;
    try {
      verified = await verifier.verify(token);
    } catch (error) {
      if (error instanceof InvalidTokenError) throw unauthorized();
      throw error;
    }
    if (!db) throw new HttpError(503, 'unavailable', 'The service is not available.');
    try {
      const user = await db.provision(verified.userId, verified.email ?? '');
      if (user.status !== 'active') throw forbidden();
    } catch (error) {
      if (error instanceof ProvisionDeniedError) throw forbidden();
      throw error;
    }
    request.accountId = verified.userId;
  });
}
