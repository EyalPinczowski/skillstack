import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { errorResponseSchema } from '../../errors';
import {
  abandonResult,
  contextView,
  createSessionBody,
  createSessionResult,
  finishBody,
  finishResult,
  historyQuery,
  historyView,
  pasteFeedbackBody,
  pasteFeedbackResult,
  planParams,
  promptView,
  putContextBody,
  putContextResult,
  sessionDetail,
  sessionParams,
  taskParams,
  trendsQuery,
  trendsView,
} from './schemas';
import type { PracticeService } from './service';

const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  422: errorResponseSchema,
  429: errorResponseSchema,
};

export interface PracticeRoutesOptions {
  service: PracticeService;
  /** The verified user's id (set by the account guard of the enclosing scope). */
  userId: (request: FastifyRequest) => string;
}

/**
 * Practice without a model (spec 3.3), under /api/v1/plans/:planId. The Terms guard of the
 * enclosing scope covers every route here; the user id is the token's, never the request's.
 */
export const practiceRoutes: FastifyPluginAsyncZod<PracticeRoutesOptions> = async (
  app,
  { service, userId },
) => {
  const security = [{ bearerAuth: [] }];
  const tags = ['practice'];

  app.get(
    '/plans/:planId/practice/context',
    {
      schema: {
        tags,
        summary: 'The job description saved for the plan (Tier 2)',
        description:
          'An empty string and `updatedAt: null` until one is saved. It is personal content: never logged, never in events, and removed of contact details before any model would see it.',
        security,
        params: planParams,
        response: { 200: contextView, ...errors },
      },
    },
    async (request) => service.getContext(userId(request), request.params.planId),
  );

  app.put(
    '/plans/:planId/practice/context',
    {
      schema: {
        tags,
        summary: 'Save the job description (an empty string clears it)',
        description:
          '`redactionsPreview` is how many personal details (emails, phone numbers, links, your own name) are removed from the text before a model could see it.',
        security,
        params: planParams,
        body: putContextBody,
        response: { 200: putContextResult, ...errors },
      },
    },
    async (request) =>
      service.putContext(userId(request), request.params.planId, request.body.jobDescription),
  );

  app.get(
    '/plans/:planId/tasks/:taskId/practice/prompt',
    {
      schema: {
        tags,
        summary: 'The ready-made prompt for a practice task',
        description:
          'Built from the task, the job description, the `next_focus` of the last finished session of the same kind in this plan that left one, and the other tasks worked on in the last 7 days. Personal details are removed. 422 when the task is not a practice. Nothing is saved.',
        security,
        params: taskParams,
        response: { 200: promptView, ...errors },
      },
    },
    async (request) =>
      service.prompt(userId(request), request.params.planId, request.params.taskId),
  );

  app.post(
    '/plans/:planId/tasks/:taskId/practice/sessions',
    {
      schema: {
        tags,
        summary: 'Start a practice session (idempotent on the client-generated id)',
        description:
          'Channels `external` (copy the prompt to another assistant, paste the feedback back) and `self` (rubric). 201 when created; 200 with the stored session for a retry of the same id, task and channel; 409 when the id was used for other data or the task already has an active session (the message names it). 422 when the task is not a practice. The stored prompt never contains the job description. Writes a `practice.started` event.',
        security,
        params: taskParams,
        body: createSessionBody,
        response: { 200: createSessionResult, 201: createSessionResult, ...errors },
      },
    },
    async (request, reply) => {
      const { created, ...result } = await service.createSession(
        userId(request),
        request.params.planId,
        request.params.taskId,
        request.body,
      );
      return reply.status(created ? 201 : 200).send(result);
    },
  );

  app.get(
    '/plans/:planId/practice/sessions/:sessionId',
    {
      schema: {
        tags,
        summary: 'One practice session with its messages and feedback',
        security,
        params: sessionParams,
        response: { 200: sessionDetail, ...errors },
      },
    },
    async (request) =>
      service.getSession(userId(request), request.params.planId, request.params.sessionId),
  );

  app.post(
    '/plans/:planId/practice/sessions/:sessionId/feedback',
    {
      schema: {
        tags,
        summary: 'Paste the feedback block and finish the session',
        description:
          'A `===FEEDBACK===` block is parsed (`parsed: true`, source `pasted_block`); any other text is saved as plain text without an error (`parsed: false`, source `free_text`, no score). The call also finishes the session: `markDone` (default false) is the only way it marks the task done, and `logHours` (0 to 12) logs time on it. Pasted feedback replaces a self-check, so there is no rubric here. 201 when finished now; 200 for a retry with the same text and options; 409 for other text or options, or an abandoned session.',
        security,
        params: sessionParams,
        body: pasteFeedbackBody,
        response: { 200: pasteFeedbackResult, 201: pasteFeedbackResult, ...errors },
      },
    },
    async (request, reply) => {
      const result = await service.pasteFeedback(
        userId(request),
        request.params.planId,
        request.params.sessionId,
        request.body,
      );
      return reply
        .status(result.replayed ? 200 : 201)
        .send({ ...result, parsed: result.parsed === true });
    },
  );

  app.post(
    '/plans/:planId/practice/sessions/:sessionId/finish',
    {
      schema: {
        tags,
        summary: 'Finish a session with a self-check, an entered score or no feedback',
        description:
          '`markDone` is required: the task is marked done only when it is true, through the tasks service, and is otherwise left as it is (logging hours still moves a pending task to in progress, as everywhere). `rubric.checkedSteps` ticks steps of the task (or four generic steps when it has none) and is scored as 10 x ticked / total; `enteredScore` is a score you got elsewhere, normalised to 0 to 10; send at most one of them. Without either, no feedback is saved. 201 when finished now; 200 for a retry with the same feedback and options; 409 otherwise, for an abandoned session, or to mark a skipped task done.',
        security,
        params: sessionParams,
        body: finishBody,
        response: { 200: finishResult, 201: finishResult, ...errors },
      },
    },
    async (request, reply) => {
      const result = await service.finish(
        userId(request),
        request.params.planId,
        request.params.sessionId,
        request.body,
      );
      return reply.status(result.replayed ? 200 : 201).send(result);
    },
  );

  app.post(
    '/plans/:planId/practice/sessions/:sessionId/abandon',
    {
      schema: {
        tags,
        summary: 'Give up a session: nothing is logged and the task is untouched',
        description: 'Idempotent. 409 for a session that is already finished.',
        security,
        params: sessionParams,
        response: { 200: abandonResult, ...errors },
      },
    },
    async (request) =>
      service.abandon(userId(request), request.params.planId, request.params.sessionId),
  );

  app.get(
    '/plans/:planId/practice/history',
    {
      schema: {
        tags,
        summary: 'Finished practice sessions, newest first (no text)',
        description:
          'Optionally one `kind` and a plan-local date range (by the day the session started). `limit` defaults to 50, at most 200.',
        security,
        params: planParams,
        querystring: historyQuery,
        response: { 200: historyView, ...errors },
      },
    },
    async (request) => service.history(userId(request), request.params.planId, request.query),
  );

  app.get(
    '/plans/:planId/practice/trends',
    {
      schema: {
        tags,
        summary: 'Score trend per practice kind',
        description:
          'Scored sessions only (free text has no score), oldest first, from the newest 1000 in the range. `last`, `average` and `delta` are computed in the shared package.',
        security,
        params: planParams,
        querystring: trendsQuery,
        response: { 200: trendsView, ...errors },
      },
    },
    async (request) => service.trends(userId(request), request.params.planId, request.query),
  );
};
