import { BlockSchema, LocalDateSchema } from '@skillstack/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema } from '../../errors';
import type { DaysService } from './service';

const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  422: errorResponseSchema,
  429: errorResponseSchema,
};

const dayParams = z.object({ planId: z.uuid(), date: LocalDateSchema });

export const dayStateSchema = z.object({
  date: LocalDateSchema,
  status: z.enum(['not_started', 'started', 'ended']),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  frozen: z
    .object({
      frozenAt: z.string(),
      source: z.enum(['day_end', 'auto_rollover']),
      blocks: z.array(BlockSchema),
    })
    .nullable(),
});

export interface DaysRoutesOptions {
  service: DaysService;
  /** The verified user's id (set by the account guard of the enclosing scope). */
  userId: (request: FastifyRequest) => string;
}

/** Start and end of a study day (spec 3.2, 3.4). All dates are local dates in the plan's time zone. */
export const daysRoutes: FastifyPluginAsyncZod<DaysRoutesOptions> = async (
  app,
  { service, userId },
) => {
  const security = [{ bearerAuth: [] }];
  const tags = ['days'];

  app.post(
    '/plans/:planId/days/:date/start',
    {
      schema: {
        tags,
        summary: 'Start a study day (idempotent)',
        description:
          'Allowed for today (in the plan’s time zone) or any earlier date of the plan; a future date answers 422. 201 when the day was started now, 200 with the same state when it already was. Writes one `day.started` event.',
        security,
        params: dayParams,
        response: { 200: dayStateSchema, 201: dayStateSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { created, day } = await service.start(
        userId(request),
        request.params.planId,
        request.params.date,
      );
      return reply.status(created ? 201 : 200).send(day);
    },
  );

  app.post(
    '/plans/:planId/days/:date/end',
    {
      schema: {
        tags,
        summary: 'End a study day and freeze its blocks (idempotent)',
        description:
          'Allowed for today or an earlier date; a future date answers 422. Stores the blocks that were planned for the date as an append-only snapshot, so the day never changes again, and marks the day ended. A retry returns the same state and writes no second `day.ended` event. A past day that was already frozen automatically keeps its snapshot.',
        security,
        params: dayParams,
        response: { 200: dayStateSchema, ...errors },
      },
    },
    async (request) => service.end(userId(request), request.params.planId, request.params.date),
  );

  app.get(
    '/plans/:planId/days/:date',
    {
      schema: {
        tags,
        summary: 'Session state of a day and its frozen blocks',
        description:
          '`frozen` is null until the day is frozen (by ending it, or automatically on the first read after it has passed). Reading brings every missed past day of the plan up to date first.',
        security,
        params: dayParams,
        response: { 200: dayStateSchema, ...errors },
      },
    },
    async (request) => service.get(userId(request), request.params.planId, request.params.date),
  );
};
