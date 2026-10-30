import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ProvisionDeniedError } from '../../db/database';
import { HttpError } from '../../errors';
import type { AccountService } from './service';
import { InvalidTokenError, type TokenVerifier } from './token-verifier';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the account guard: the user id comes only from the verified token's `sub`. */
    accountId?: string;
  }
}

const unauthorized = () => new HttpError(401, 'unauthorized', 'Authentication is required.');
/** One message for every refusal (not on the list, cap reached, disabled): nothing to probe. */
const forbidden = () => new HttpError(403, 'forbidden', 'This account cannot use Skillstack.');

/** A bearer token of token characters only: a linear check, no backtracking on user input. */
function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length);
  return /^[A-Za-z0-9._~+/=-]+$/.test(token) ? token : null;
}

/**
 * Verifies the token, provisions the account on first use and checks it is active. Install it
 * once in every plugin scope that serves signed-in routes; it sets `request.accountId` from the
 * verified token and from nowhere else.
 */
export function installAccountGuard(
  app: FastifyInstance,
  verifier: TokenVerifier,
  service: AccountService | null,
): void {
  app.decorateRequest('accountId', undefined);
  app.addHook('onRequest', async (request) => {
    const token = bearerToken(request);
    if (!token) throw unauthorized();
    let verified;
    try {
      verified = await verifier.verify(token);
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        request.log.info({ reason: error.message }, 'token rejected');
        throw unauthorized();
      }
      throw error;
    }
    if (!service) throw new HttpError(503, 'unavailable', 'The service is not available.');
    try {
      const user = await service.provision(verified.userId, verified.email);
      if (user.status !== 'active') throw forbidden();
    } catch (error) {
      if (error instanceof ProvisionDeniedError) {
        // The reason is for the operator only; the client gets the same answer every time.
        request.log.info({ reason: error.reason }, 'account not provisioned');
        throw forbidden();
      }
      throw error;
    }
    request.accountId = verified.userId;
  });
}
