import {
  BlockSchema,
  DayOverrideSchema,
  LocalDateSchema,
  WeekPatternSchema,
} from '@skillstack/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema } from '../../errors';
import { planIdParams } from '../plans/schemas';
import type { SchedulingService } from './service';

const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  422: errorResponseSchema,
  429: errorResponseSchema,
};

/** Engine warnings keep the engine's own shape (a `kind` plus its fields). */
const warningSchema = z.looseObject({ kind: z.string() });

const scheduleSchema = z.object({
  today: LocalDateSchema,
  timezone: z.string(),
  finishDate: LocalDateSchema.nullable(),
  blocks: z.array(BlockSchema),
  warnings: z.array(warningSchema),
});

const previewBody = z.object({
  today: LocalDateSchema.optional(),
  pattern: WeekPatternSchema.optional(),
  overrides: z.array(DayOverrideSchema).max(366).optional(),
  removeOverrideDates: z.array(LocalDateSchema).max(366).optional(),
});

const previewSchema = z.object({
  today: LocalDateSchema,
  summary: z.object({
    movedTaskIds: z.array(z.string()),
    finishBefore: LocalDateSchema.nullable(),
    finishAfter: LocalDateSchema.nullable(),
    finishChanged: z.boolean(),
    finishShiftStudyDays: z.number().int(),
    newAnchorRisks: z.array(z.string()),
    text: z.string(),
  }),
  current: z.object({ finishDate: LocalDateSchema.nullable(), warnings: z.array(warningSchema) }),
  proposed: z.object({
    finishDate: LocalDateSchema.nullable(),
    warnings: z.array(warningSchema),
    blocks: z.array(BlockSchema),
  }),
});

const openTasksSchema = z.object({
  today: LocalDateSchema,
  weekStart: LocalDateSchema,
  weekEnd: LocalDateSchema,
  tasks: z.array(
    z.object({
      taskId: z.string(),
      title: z.string(),
      type: z.string(),
      status: z.enum(['pending', 'in_progress', 'skipped']),
      estHours: z.number(),
      doneHours: z.number(),
      remainingHours: z.number(),
      plannedDates: z.array(LocalDateSchema),
      carriedOverFrom: z.array(LocalDateSchema),
    }),
  ),
});

export interface SchedulingRoutesOptions {
  service: SchedulingService;
  /** The verified user's id (set by the account guard of the enclosing scope). */
  userId: (request: FastifyRequest) => string;
}

export const schedulingRoutes: FastifyPluginAsyncZod<SchedulingRoutesOptions> = async (
  app,
  { service, userId },
) => {
  app.get(
    '/plans/:id/schedule',
    {
      schema: {
        tags: ['scheduling'],
        summary: 'The plan’s computed schedule (blocks, warnings, finish date)',
        description:
          '`today` defaults to the current date in the plan’s time zone. Days before `today` are not scheduled. Nothing is saved.',
        security: [{ bearerAuth: [] }],
        params: planIdParams,
        querystring: z.object({ today: LocalDateSchema.optional() }),
        response: { 200: scheduleSchema, ...errors },
      },
    },
    async (request) => service.getSchedule(userId(request), request.params.id, request.query.today),
  );

  app.post(
    '/plans/:id/schedule/preview',
    {
      schema: {
        tags: ['scheduling'],
        summary: 'What a pattern or override change would do, without saving it',
        description:
          'Plan changes are suggestions until the user approves them: this endpoint only computes the change summary and the proposed schedule. Apply a change with the PUT endpoints.',
        security: [{ bearerAuth: [] }],
        params: planIdParams,
        body: previewBody,
        response: { 200: previewSchema, ...errors },
      },
    },
    async (request) => service.preview(userId(request), request.params.id, request.body),
  );

  app.get(
    '/plans/:id/open-tasks',
    {
      schema: {
        tags: ['scheduling'],
        summary: 'Open tasks of the week, with the days they were carried over from',
        description:
          'Tasks that are not done and are either planned this week (Sunday to Saturday in the plan’s time zone, the week that holds `today`) or were planned on an earlier frozen day and are still open. A skipped task appears (status `skipped`) only when it was planned on an earlier frozen day, so it can be reconsidered; reopen it to plan it again. `carriedOverFrom` lists those earlier dates; it is empty for a task that is only planned ahead. `today` defaults to the current date in the plan’s time zone.',
        security: [{ bearerAuth: [] }],
        params: planIdParams,
        querystring: z.object({ today: LocalDateSchema.optional() }),
        response: { 200: openTasksSchema, ...errors },
      },
    },
    async (request) => service.openTasks(userId(request), request.params.id, request.query.today),
  );
};
