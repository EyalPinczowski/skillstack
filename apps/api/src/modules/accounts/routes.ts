import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../../db/database';
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
import { installAccountGuard } from './guard';
import type { TokenVerifier } from './token-verifier';

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

  installAccountGuard(app, verifier, service);

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
