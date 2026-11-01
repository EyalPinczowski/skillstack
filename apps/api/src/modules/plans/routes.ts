import { DayOverrideSchema, WeekPatternSchema } from '@skillstack/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../../db/database';
import { errorResponseSchema } from '../../errors';
import { installAccountGuard } from '../accounts/guard';
import { createAccountService } from '../accounts/service';
import type { TokenVerifier } from '../accounts/token-verifier';
import { briefingRoutes } from '../briefing/routes';
import { createBriefingService } from '../briefing/service';
import { daysRoutes } from '../days/routes';
import { createDaysService } from '../days/service';
import { practiceRoutes } from '../practice/routes';
import { createPracticeService } from '../practice/service';
import { reviewRoutes } from '../reviews/routes';
import { createReviewService } from '../reviews/service';
import { schedulingRoutes } from '../scheduling/routes';
import { createSchedulingService } from '../scheduling/service';
import { createTaskService } from '../tasks/service';
import { validateImport } from './import';
import {
  dayOverrideBody,
  dayOverrideParams,
  importPlanBody,
  MAX_IMPORT_BODY_BYTES,
  planDetailSchema,
  planIdParams,
  planListSchema,
} from './schemas';
import { createPlanService } from './service';

export interface PlanRoutesOptions {
  verifier: TokenVerifier;
  /** Null when no database is configured: the routes then answer 503. */
  db: Database | null;
  /** The clock; tests inject a fixed one. Defaults to the system time. */
  now?: () => Date;
}

const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  422: errorResponseSchema,
  429: errorResponseSchema,
};

/** Plans, their time settings and the read side of scheduling, all under /api/v1/plans. */
export const planRoutes: FastifyPluginAsyncZod<PlanRoutesOptions> = async (
  app,
  { verifier, db, now },
) => {
  const accounts = db ? createAccountService(db) : null;
  installAccountGuard(app, verifier, accounts);

  // The user id comes only from the verified token (set by the guard), never from the request.
  const userId = (request: FastifyRequest) => request.accountId!;
  // Without a database the guard already answered 503, so a handler never runs with `plans` null.
  const plans = createPlanService(db!);

  app.post(
    '/plans/import',
    {
      bodyLimit: MAX_IMPORT_BODY_BYTES,
      schema: {
        tags: ['plans'],
        summary: 'Import a plan file (idempotent on the client-generated plan id)',
        description:
          'The body is a plan file (formatVersion 1) plus `id` (a UUID chosen by the client) and an optional `status` of `draft` or `active` (default `active`). Creates the plan, its week pattern, day overrides and tasks in one transaction. 201 on creation; 200 with the stored plan when the same id and content are sent again; 409 when the id exists with different content.',
        security: [{ bearerAuth: [] }],
        body: importPlanBody,
        response: {
          200: planDetailSchema,
          201: planDetailSchema,
          409: errorResponseSchema,
          413: errorResponseSchema,
          ...errors,
        },
      },
    },
    async (request, reply) => {
      const { id, status, ...file } = request.body;
      const valid = validateImport(file, status);
      const result = await plans.importPlan(userId(request), id, valid);
      return reply.status(result.created ? 201 : 200).send(result.plan);
    },
  );

  app.get(
    '/plans',
    {
      schema: {
        tags: ['plans'],
        summary: 'The signed-in user’s plans (summaries)',
        security: [{ bearerAuth: [] }],
        response: { 200: planListSchema, ...errors },
      },
    },
    async (request) => ({ plans: await plans.list(userId(request)) }),
  );

  app.get(
    '/plans/:id',
    {
      schema: {
        tags: ['plans'],
        summary: 'A plan with its week pattern, day overrides and tasks',
        security: [{ bearerAuth: [] }],
        params: planIdParams,
        response: { 200: planDetailSchema, ...errors },
      },
    },
    async (request) => plans.get(userId(request), request.params.id),
  );

  app.delete(
    '/plans/:id',
    {
      schema: {
        tags: ['plans'],
        summary: 'Delete a plan and everything it owns',
        security: [{ bearerAuth: [] }],
        params: planIdParams,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      await plans.remove(userId(request), request.params.id);
      return reply.status(204).send(null);
    },
  );

  app.put(
    '/plans/:id/week-pattern',
    {
      schema: {
        tags: ['plans'],
        summary: 'Replace the plan’s weekly time settings (spec 3.7)',
        description:
          'Saves the settings. To see what a change would do first, use POST /plans/{id}/schedule/preview.',
        security: [{ bearerAuth: [] }],
        params: planIdParams,
        body: WeekPatternSchema,
        response: { 200: WeekPatternSchema, ...errors },
      },
    },
    async (request) => plans.putWeekPattern(userId(request), request.params.id, request.body),
  );

  app.put(
    '/plans/:id/day-overrides/:date',
    {
      schema: {
        tags: ['plans'],
        summary: 'Set the exception for one date (day off, extra study day, other hours)',
        security: [{ bearerAuth: [] }],
        params: dayOverrideParams,
        body: dayOverrideBody,
        response: { 200: DayOverrideSchema, ...errors },
      },
    },
    async (request) =>
      plans.putDayOverride(userId(request), request.params.id, {
        ...request.body,
        date: request.params.date,
      }),
  );

  app.delete(
    '/plans/:id/day-overrides/:date',
    {
      schema: {
        tags: ['plans'],
        summary: 'Remove the exception for one date (succeeds if there is none)',
        security: [{ bearerAuth: [] }],
        params: dayOverrideParams,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      await plans.removeDayOverride(userId(request), request.params.id, request.params.date);
      return reply.status(204).send(null);
    },
  );

  // Without a database the guard already answered 503, so these never run with `db` null.
  const days = createDaysService(db!, now);
  const scheduling = createSchedulingService(db!, days);
  app.register(schedulingRoutes, { service: scheduling, userId });
  app.register(briefingRoutes, { service: createBriefingService(scheduling), userId });
  app.register(daysRoutes, { service: days, userId });
  app.register(reviewRoutes, { service: createReviewService(db!, days, scheduling), userId });
  app.register(practiceRoutes, {
    service: createPracticeService(db!, createTaskService(db!, now), now),
    userId,
  });
};
