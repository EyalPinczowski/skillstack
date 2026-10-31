import { BriefingSchema, LocalDateSchema } from '@skillstack/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema } from '../../errors';
import type { BriefingService } from './service';

const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  422: errorResponseSchema,
  429: errorResponseSchema,
};

export interface BriefingRoutesOptions {
  service: BriefingService;
  /** The verified user's id (set by the account guard of the enclosing scope). */
  userId: (request: FastifyRequest) => string;
}

/** The day briefing (spec 3.2), under /api/v1/plans. */
export const briefingRoutes: FastifyPluginAsyncZod<BriefingRoutesOptions> = async (
  app,
  { service, userId },
) => {
  app.get(
    '/plans/:planId/days/:date/briefing',
    {
      schema: {
        tags: ['days'],
        summary: 'The briefing for a study day (template-only, deterministic)',
        description:
          'Allowed for today (in the plan’s time zone) or an earlier date of the plan; a future date answers 422. A day that has been frozen (ended, or rolled over) uses its stored blocks, so its briefing does not change when the plan is edited later. `source` is always `template` in v0.2: no AI model is called. Links, providers and lesson titles appear only when the plan’s tasks have them. Reading brings every missed past day up to date first; nothing else is written and no event is logged.',
        security: [{ bearerAuth: [] }],
        params: z.object({ planId: z.uuid(), date: LocalDateSchema }),
        response: { 200: BriefingSchema, ...errors },
      },
    },
    async (request) => service.get(userId(request), request.params.planId, request.params.date),
  );
};
