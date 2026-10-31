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
import { AuthAdminError, type AuthAdmin } from './auth-admin';
import { createAccountService } from './service';
import { installAccountGuard } from './guard';
import type { TokenVerifier } from './token-verifier';

export interface AccountRoutesOptions {
  verifier: TokenVerifier;
  /** Null when no database is configured: the routes then answer 503. */
  db: Database | null;
  /** Removes the Supabase Auth user on account deletion. */
  authAdmin: AuthAdmin;
}

const authErrors = {
  401: errorResponseSchema,
  403: errorResponseSchema,
  429: errorResponseSchema,
};

export const accountRoutes: FastifyPluginAsyncZod<AccountRoutesOptions> = async (
  app,
  { verifier, db, authAdmin },
) => {
  const service = db ? createAccountService(db, authAdmin) : null;

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
        description: `The body must contain {"confirmation": "${DELETE_CONFIRMATION}"}. Deletes the Skillstack data and the Supabase Auth user together; if the Auth user cannot be deleted, nothing is deleted (502) and the request can be retried.`,
        security: [{ bearerAuth: [] }],
        body: deleteMeBody,
        response: {
          204: z.null(),
          422: errorResponseSchema,
          502: errorResponseSchema,
          ...authErrors,
        },
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
      try {
        await service!.deleteAccount(userId(request));
      } catch (error) {
        if (error instanceof AuthAdminError) {
          // Nothing was deleted (rolled back). The message is fixed text: no key, URL or body.
          request.log.error(
            { reason: error.message, status: error.status },
            'auth user deletion failed',
          );
          throw new HttpError(
            502,
            'auth_deletion_failed',
            'We could not delete your sign-in record, so nothing was deleted. Try again.',
          );
        }
        throw error;
      }
      return reply.status(204).send(null);
    },
  );
};
