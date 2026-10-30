import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../../db/database';
import { ProvisionDeniedError } from '../../db/database';
import { errorResponseSchema, HttpError } from '../../errors';
import { CURRENT_LEGAL_VERSIONS } from './legal';
import {
  acceptLegalBody,
  DELETE_CONFIRMATION,
  deleteMeBody,
  exportSchema,
  meSchema,
  updateMeBody,
} from './schemas';
import { createAccountService } from './service';
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

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(header);
  return match ? match[1]! : null;
}

export interface AccountRoutesOptions {
  verifier: TokenVerifier;
  /** Null when no database is configured: the routes then answer 503. */
  db: Database | null;
}

const authErrors = {
  401: errorResponseSchema,
  403: errorResponseSchema,
  429: errorResponseSchema,
};

export const accountRoutes: FastifyPluginAsyncZod<AccountRoutesOptions> = async (
  app,
  { verifier, db },
) => {
  const service = db ? createAccountService(db) : null;

  /** Verifies the token, provisions the account on first use and checks it is active. */
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

  const userId = (request: FastifyRequest) => request.accountId!;

  app.get(
    '/me',
    {
      schema: {
        tags: ['accounts'],
        summary: 'The signed-in user (creates the profile on first call)',
        security: [{ bearerAuth: [] }],
        response: { 200: meSchema, ...authErrors },
      },
    },
    async (request) => service!.getMe(userId(request)),
  );

  app.patch(
    '/me',
    {
      schema: {
        tags: ['accounts'],
        summary: 'Change the display name',
        security: [{ bearerAuth: [] }],
        body: updateMeBody,
        response: { 200: meSchema, ...authErrors },
      },
    },
    async (request) => service!.updateDisplayName(userId(request), request.body.displayName),
  );

  app.post(
    '/me/legal-acceptances',
    {
      schema: {
        tags: ['accounts'],
        summary: 'Accept the current Terms or Privacy Policy (idempotent)',
        security: [{ bearerAuth: [] }],
        body: acceptLegalBody,
        response: { 200: meSchema, 422: errorResponseSchema, ...authErrors },
      },
    },
    async (request) => {
      const { document, version } = request.body;
      if (version !== CURRENT_LEGAL_VERSIONS[document]) {
        throw new HttpError(422, 'unprocessable', 'Only the current version can be accepted.');
      }
      return service!.acceptLegal(userId(request), document, version);
    },
  );

  app.get(
    '/me/export',
    {
      schema: {
        tags: ['accounts'],
        summary: 'Download everything the account holds as JSON',
        security: [{ bearerAuth: [] }],
        response: { 200: exportSchema, ...authErrors },
      },
    },
    async (request, reply) => {
      reply.header('content-disposition', 'attachment; filename="skillstack-export.json"');
      reply.header('cache-control', 'no-store');
      return service!.exportData(userId(request));
    },
  );

  app.delete(
    '/me',
    {
      schema: {
        tags: ['accounts'],
        summary: 'Delete the account and all its data',
        description: `The body must contain {"confirmation": "${DELETE_CONFIRMATION}"}.`,
        security: [{ bearerAuth: [] }],
        body: deleteMeBody,
        response: { 204: z.null(), 422: errorResponseSchema, ...authErrors },
      },
    },
    async (request, reply) => {
      if (request.body.confirmation !== DELETE_CONFIRMATION) {
        throw new HttpError(
          422,
          'unprocessable',
          `Type "${DELETE_CONFIRMATION}" to confirm the deletion.`,
        );
      }
      await service!.deleteAccount(userId(request));
      return reply.status(204).send(null);
    },
  );
};
