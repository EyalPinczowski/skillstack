import { DayReviewInputSchema } from '@skillstack/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { errorResponseSchema } from '../../errors';
import {
  acceptBody,
  decisionResult,
  historyQuery,
  plansParams,
  previewQuery,
  putReviewResult,
  rejectBody,
  reviewHistory,
  reviewParams,
  reviewView,
  suggestionList,
  suggestionParams,
  suggestionPreview,
} from './schemas';
import type { ReviewService } from './service';

const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  422: errorResponseSchema,
  429: errorResponseSchema,
};

export interface ReviewRoutesOptions {
  service: ReviewService;
  /** The verified user's id (set by the account guard of the enclosing scope). */
  userId: (request: FastifyRequest) => string;
}

/** End-of-day reviews and adjustment suggestions (spec 3.4), all under /api/v1/plans/:planId. */
export const reviewRoutes: FastifyPluginAsyncZod<ReviewRoutesOptions> = async (
  app,
  { service, userId },
) => {
  const security = [{ bearerAuth: [] }];
  const tags = ['reviews'];

  app.put(
    '/plans/:planId/days/:date/review',
    {
      schema: {
        tags,
        summary: 'Submit or re-save the end-of-day review (idempotent)',
        description:
          'The body is the review (`date` must equal the URL date). Allowed for today (in the plan’s time zone) or an earlier date of the plan that was a study day or has logged work or a started session; a future date answers 422, and so does an outcome that names a task of another plan. 201 when the review was stored now, 200 when it already existed: the same content changes nothing, other content re-saves it, which is allowed only on the review’s day and the day after (409 later). Writes `review.submitted` (first save) or `review.updated` (a real change) events. The review never logs hours and never marks a task done: `missingLogs` and `notMarkedDone` tell the client what the user may still do. `suggestions` are the open adjustment suggestions after this review; nothing is saved for them until the user decides.',
        security,
        params: reviewParams,
        body: DayReviewInputSchema,
        response: { 200: putReviewResult, 201: putReviewResult, ...errors },
      },
    },
    async (request, reply) => {
      const result = await service.put(
        userId(request),
        request.params.planId,
        request.params.date,
        request.body,
      );
      return reply.status(result.created ? 201 : 200).send(result);
    },
  );

  app.get(
    '/plans/:planId/days/:date/review',
    {
      schema: {
        tags,
        summary: 'The review of one day',
        description: '404 when the day has no review.',
        security,
        params: reviewParams,
        response: { 200: reviewView, ...errors },
      },
    },
    async (request) =>
      service.getReview(userId(request), request.params.planId, request.params.date),
  );

  app.get(
    '/plans/:planId/reviews',
    {
      schema: {
        tags,
        summary: 'Rating history for the trend charts (difficulty, density, energy per day)',
        description:
          'Oldest first, optionally limited to `from`..`to` (inclusive). At most the latest 366 days. Notes and outcomes are not part of the history; read one day for those.',
        security,
        params: plansParams,
        querystring: historyQuery,
        response: { 200: reviewHistory, ...errors },
      },
    },
    async (request) =>
      service.history(userId(request), request.params.planId, request.query.from, request.query.to),
  );

  app.get(
    '/plans/:planId/suggestions',
    {
      schema: {
        tags,
        summary: 'The open adjustment suggestions, recomputed from the plan’s current state',
        description:
          'Transparent rules (spec 3.4) applied to reviews, logs and tasks. Nothing is stored for a suggestion until it is accepted or rejected; ids are stable for the same evidence, and new evidence gives a new id.',
        security,
        params: plansParams,
        response: { 200: suggestionList, ...errors },
      },
    },
    async (request) => service.suggestions(userId(request), request.params.planId),
  );

  app.post(
    '/plans/:planId/suggestions/:id/preview',
    {
      schema: {
        tags,
        summary: 'What accepting a suggestion option would do, without saving it',
        description:
          'Applies option `option` (0 = the recommended change) to a copy of the plan, schedules both and returns the change summary and the new finish date. 409 when the suggestion is not open any more; 422 for an option it does not have.',
        security,
        params: suggestionParams,
        querystring: previewQuery,
        response: { 200: suggestionPreview, ...errors },
      },
    },
    async (request) =>
      service.preview(
        userId(request),
        request.params.planId,
        request.params.id,
        request.query.option,
      ),
  );

  app.post(
    '/plans/:planId/suggestions/:id/accept',
    {
      schema: {
        tags,
        summary: 'Accept a suggestion option (idempotent on the suggestion id)',
        description:
          'The body holds only `option` (default 0); a proposed change is never accepted from the client (400 for any other key). The suggestion is recomputed from the stored state, applied in one transaction (week pattern, day overrides, task estimates or a new practice task), stored as an adjustment with its evidence, and a `schedule.changed` event is written. 201 when applied now; 200 with the stored result when this id was already accepted with the same option; 409 when it was rejected, accepted with another option, or is not open any more (stale evidence or unknown id).',
        security,
        params: suggestionParams,
        body: acceptBody,
        response: { 200: decisionResult, 201: decisionResult, ...errors },
      },
    },
    async (request, reply) => {
      const result = await service.accept(
        userId(request),
        request.params.planId,
        request.params.id,
        request.body?.option ?? 0,
      );
      return reply.status(result.created ? 201 : 200).send({
        adjustment: result.adjustment,
        summary: result.summary,
        replayed: !result.created,
      });
    },
  );

  app.post(
    '/plans/:planId/suggestions/:id/reject',
    {
      schema: {
        tags,
        summary: 'Reject a suggestion so it is not offered again (idempotent)',
        description:
          'Stores the rejection with its evidence. The same evidence is not offered again; new evidence gives a new suggestion. 201 when stored now, 200 when it was already rejected, 409 when it was accepted or is not open any more.',
        security,
        params: suggestionParams,
        body: rejectBody,
        response: { 200: decisionResult, 201: decisionResult, ...errors },
      },
    },
    async (request, reply) => {
      const result = await service.reject(
        userId(request),
        request.params.planId,
        request.params.id,
      );
      return reply
        .status(result.created ? 201 : 200)
        .send({ adjustment: result.adjustment, summary: null, replayed: !result.created });
    },
  );
};
