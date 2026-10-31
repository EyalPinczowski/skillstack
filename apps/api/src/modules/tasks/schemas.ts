import { LessonSchema, LocalDateSchema, TaskSchema } from '@skillstack/shared';
import { z } from 'zod';
import { noNulCharacters } from '../../validation';

const shape = TaskSchema.shape;

export const planParams = z.object({ planId: z.uuid() });
export const taskParams = noNulCharacters(
  z.object({ planId: z.uuid(), taskId: z.string().min(1).max(200) }),
);

/** A task as the API shows it: the shared task shape (absent optional fields are left out). */
export const taskView = z.object({
  id: shape.id,
  title: shape.title,
  type: shape.type,
  provider: z.string().optional(),
  url: z.string().optional(),
  estHours: z.number(),
  doneHours: z.number(),
  status: shape.status,
  order: z.number().int(),
  dependsOn: z.array(z.string()),
  isAnchor: z.boolean(),
  anchorDate: LocalDateSchema.optional(),
  anchorStartTime: z.string().optional(),
  pinnedStart: z.object({ date: LocalDateSchema, start: z.string() }).optional(),
  notBefore: LocalDateSchema.optional(),
  splittable: z.boolean(),
  isCertificate: z.boolean(),
  certificateName: z.string().optional(),
  lessons: z.array(LessonSchema),
  howToSteps: z.array(z.string()),
  promptTemplate: z.string().optional(),
  practiceKind: z.string().optional(),
  notes: z.string().optional(),
  source: shape.source,
  externalRef: z.string().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type TaskView = z.infer<typeof taskView>;

export const taskList = z.object({ tasks: z.array(taskView) });

/**
 * The fields the user may edit by hand. Strict: `status`, `doneHours`, `source`, `id`, `userId`,
 * `planId` and every other key are rejected with 400, never silently ignored. Optional text
 * fields take `null` to clear them. Field rules come from the shared task schema.
 */
export const patchTaskBody = noNulCharacters(
  z
    .strictObject({
      title: shape.title,
      provider: z.string().min(1).max(200).nullable(),
      url: shape.url.unwrap().nullable(),
      estHours: shape.estHours,
      order: shape.order,
      dependsOn: shape.dependsOn.unwrap().max(200),
      notBefore: LocalDateSchema.nullable(),
      splittable: shape.splittable.unwrap(),
      certificateName: z.string().min(1).max(200).nullable(),
      lessons: shape.lessons.unwrap().max(500),
      howToSteps: shape.howToSteps.unwrap().max(200),
      promptTemplate: z.string().max(20_000).nullable(),
      practiceKind: z.string().max(100).nullable(),
      notes: z.string().max(10_000).nullable(),
    })
    .partial()
    .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' }),
);
export type PatchTaskBody = z.infer<typeof patchTaskBody>;

export const logBody = noNulCharacters(
  z.strictObject({
    /** Client-generated, so a retried request cannot create a second log. */
    id: z.uuid(),
    date: LocalDateSchema,
    hours: z.number().gt(0).max(24),
    result: z.string().max(200).optional(),
    score: z.number().min(0).max(100_000).optional(),
    note: z.string().max(5000).optional(),
  }),
);
export type LogBody = z.infer<typeof logBody>;

export const logView = z.object({
  id: z.uuid(),
  planId: z.uuid(),
  taskId: z.string(),
  date: LocalDateSchema,
  hours: z.number(),
  result: z.string().optional(),
  score: z.number().optional(),
  note: z.string().optional(),
  createdAt: z.iso.datetime(),
});
export type LogView = z.infer<typeof logView>;

export const logResult = z.object({
  log: logView,
  task: taskView,
  /** True when the logged hours reach the estimate. The user decides; nothing is closed here. */
  suggestDone: z.boolean(),
});

export const logsQuery = z
  .object({ from: LocalDateSchema.optional(), to: LocalDateSchema.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'from must not be after to' });

export const logList = z.object({ logs: z.array(logView) });

export const progressView = z.object({
  hours: z.object({ planned: z.number(), done: z.number() }),
  tasks: z.object({ total: z.number().int(), done: z.number().int(), skipped: z.number().int() }),
  certificatesEarned: z.number().int(),
  certificates: z.array(z.object({ taskId: z.string(), name: z.string().nullable() })),
  byType: z.array(
    z.object({
      type: shape.type,
      plannedHours: z.number(),
      doneHours: z.number(),
      tasksTotal: z.number().int(),
      tasksDone: z.number().int(),
    }),
  ),
  byDay: z.array(z.object({ date: LocalDateSchema, hours: z.number(), entries: z.number().int() })),
});
