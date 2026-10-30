import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import type { Database } from '../../db/database';
import { errorResponseSchema } from '../../errors';
import type { TokenVerifier } from '../accounts/token-verifier';
import { installAccountGuard } from './auth';
import {
  logBody,
  logList,
  logResult,
  logsQuery,
  patchTaskBody,
  planParams,
  progressView,
  taskList,
  taskParams,
  taskView,
} from './schemas';
import { createTaskService } from './service';

export interface TaskRoutesOptions {
  verifier: TokenVerifier;
  /** Null when no database is configured: the routes then answer 503. */
  db: Database | null;
}

const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  429: errorResponseSchema,
};
const security = [{ bearerAuth: [] }];
const tags = ['tasks'];

export const taskRoutes: FastifyPluginAsyncZod<TaskRoutesOptions> = async (
  app,
  { verifier, db },
) => {
  installAccountGuard(app, { verifier, db });
  const service = db ? createTaskService(db) : null;
  /** The user id comes only from the verified token, never from the request. */
  const user = (request: FastifyRequest) => request.accountId!;

  app.get(
    '/plans/:planId/tasks',
    {
      schema: {
        tags,
        summary: 'The tasks of a plan, in plan order',
        security,
        params: planParams,
        response: { 200: taskList, ...errors },
      },
    },
    async (request) => ({ tasks: await service!.listTasks(user(request), request.params.planId) }),
  );

  app.get(
    '/plans/:planId/tasks/:taskId',
    {
      schema: {
        tags,
        summary: 'One task',
        security,
        params: taskParams,
        response: { 200: taskView, ...errors },
      },
    },
    async (request) => {
      const { planId, taskId } = request.params;
      return service!.getTask(user(request), planId, taskId);
    },
  );

  app.patch(
    '/plans/:planId/tasks/:taskId',
    {
      schema: {
        tags,
        summary: "Edit a task's own fields (the user's explicit edit)",
        description:
          'Title, notes, estimate, order, dependencies, not-before date, splittable, link, provider, lessons and steps only. Status and done hours change only through logs, complete, reopen and skip. Unknown fields are rejected. Dependencies must be tasks of the same plan and must not form a loop (422).',
        security,
        params: taskParams,
        body: patchTaskBody,
        response: { 200: taskView, 422: errorResponseSchema, ...errors },
      },
    },
    async (request) => {
      const { planId, taskId } = request.params;
      return service!.patchTask(user(request), planId, taskId, request.body);
    },
  );

  app.post(
    '/plans/:planId/tasks/:taskId/logs',
    {
      schema: {
        tags,
        summary: 'Log hours worked on a task (idempotent by the client-generated log id)',
        description:
          'Creates the log (201) or, for a retry with the same id and data, returns it (200). The same id with different data answers 409. done_hours becomes the sum of the logs; the first log moves a pending task to in_progress. The task is never closed here: when the hours reach the estimate the response sets suggestDone and the user completes it explicitly.',
        security,
        params: taskParams,
        body: logBody,
        response: {
          200: logResult,
          201: logResult,
          409: errorResponseSchema,
          ...errors,
        },
      },
    },
    async (request, reply) => {
      const { planId, taskId } = request.params;
      const { replayed, ...result } = await service!.addLog(
        user(request),
        planId,
        taskId,
        request.body,
      );
      return reply.status(replayed ? 200 : 201).send(result);
    },
  );

  const action = (
    name: 'complete' | 'reopen' | 'skip',
    summary: string,
    method: 'completeTask' | 'reopenTask' | 'skipTask',
  ) =>
    app.post(
      `/plans/:planId/tasks/:taskId/${name}`,
      {
        schema: {
          tags,
          summary,
          description: 'An explicit user action. Idempotent.',
          security,
          params: taskParams,
          response: { 200: taskView, 409: errorResponseSchema, ...errors },
        },
      },
      async (request) => {
        const { planId, taskId } = request.params;
        return service![method](user(request), planId, taskId);
      },
    );
  action('complete', 'Mark a task done (done hours stay as logged)', 'completeTask');
  action('reopen', 'Reopen a done or skipped task', 'reopenTask');
  action('skip', 'Skip a task', 'skipTask');

  app.get(
    '/plans/:planId/progress',
    {
      schema: {
        tags,
        summary: 'Hours, tasks, certificates, per-type and per-day totals of a plan',
        security,
        params: planParams,
        response: { 200: progressView, ...errors },
      },
    },
    async (request) => service!.progress(user(request), request.params.planId),
  );

  app.get(
    '/plans/:planId/logs',
    {
      schema: {
        tags,
        summary: 'Logs of a plan, optionally between two local dates (inclusive)',
        security,
        params: planParams,
        querystring: logsQuery,
        response: { 200: logList, ...errors },
      },
    },
    async (request) => {
      const { from, to } = request.query;
      return { logs: await service!.listLogs(user(request), request.params.planId, from, to) };
    },
  );
};
