import { z } from 'zod';
import { isLocalDate, isTime, parseTime } from './dates';

/**
 * Shared data shapes (spec section 4). The API validates with these schemas and the web app
 * uses the inferred types, so both sides always agree on the data. Field names follow the
 * spec, plus the fields the guided intake fills (`data/catalog/questions.json` `maps_to`).
 */

export const LocalDateSchema = z
  .string()
  .refine(isLocalDate, { message: 'Expected a valid date in YYYY-MM-DD format' });

export const TimeSchema = z.string().refine(isTime, { message: 'Expected a time in HH:MM format' });

export const TaskTypeSchema = z.enum(['course', 'cert_exam', 'practice', 'admin', 'cv_update']);
export const TaskStatusSchema = z.enum(['pending', 'in_progress', 'done', 'skipped']);
/** Where a task came from (spec 12.3: `source` and `external_ref` for future integrations). */
export const TaskSourceSchema = z.enum(['manual', 'import', 'builder', 'auto']);

export const LessonSchema = z.object({
  title: z.string().min(1),
  url: z.url().optional(),
  estMinutes: z.number().int().positive().optional(),
  summary: z.string().optional(),
  /** True until the link has been confirmed on the provider's own site. */
  needsCheck: z.boolean().default(false),
});

export const PinnedStartSchema = z.object({ date: LocalDateSchema, start: TimeSchema });

export const TaskSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    type: TaskTypeSchema,
    provider: z.string().optional(),
    url: z.url().optional(),
    estHours: z.number().positive().max(500),
    doneHours: z.number().min(0).default(0),
    status: TaskStatusSchema.default('pending'),
    order: z.number().int().min(0),
    dependsOn: z.array(z.string().min(1)).default([]),
    isAnchor: z.boolean().default(false),
    anchorDate: LocalDateSchema.optional(),
    anchorStartTime: TimeSchema.optional(),
    pinnedStart: PinnedStartSchema.optional(),
    /** The task may not be scheduled before this date (e.g. "sign up, not before Nov 1"). */
    notBefore: LocalDateSchema.optional(),
    splittable: z.boolean().default(true),
    isCertificate: z.boolean().default(false),
    certificateName: z.string().optional(),
    lessons: z.array(LessonSchema).default([]),
    howToSteps: z.array(z.string()).default([]),
    promptTemplate: z.string().optional(),
    practiceKind: z.string().optional(),
    notes: z.string().optional(),
    source: TaskSourceSchema.default('manual'),
    externalRef: z.string().optional(),
  })
  .superRefine((task, ctx) => {
    if (task.isAnchor && (!task.anchorDate || !task.anchorStartTime)) {
      ctx.addIssue({
        code: 'custom',
        message: 'An anchor task needs anchorDate and anchorStartTime',
        path: ['anchorDate'],
      });
    }
    if (task.dependsOn.includes(task.id)) {
      ctx.addIssue({
        code: 'custom',
        message: 'A task cannot depend on itself',
        path: ['dependsOn'],
      });
    }
  });

const WeekdaySchema = z.number().int().min(0).max(6);

export const WeekPatternSchema = z
  .object({
    /** 0 = Sunday … 6 = Saturday. */
    studyWeekdays: z.array(WeekdaySchema).min(1),
    defaultHours: z.number().min(0).max(24),
    /** Optional per-weekday override, keyed "0"–"6" (e.g. { "4": 5 } = Thursday 5 h). */
    hoursByWeekday: z.record(z.string().regex(/^[0-6]$/), z.number().min(0).max(24)).default({}),
    windowStart: TimeSchema,
    windowEnd: TimeSchema,
    lunchStart: TimeSchema.optional(),
    lunchEnd: TimeSchema.optional(),
    breakEveryHours: z.number().positive().max(12).default(2),
    breakMinutes: z.number().int().min(0).max(120).default(10),
    minBlockMinutes: z.number().int().min(5).max(240).default(30),
    timezone: z.string().min(1),
  })
  .superRefine((p, ctx) => {
    if (parseTime(p.windowEnd) <= parseTime(p.windowStart)) {
      ctx.addIssue({
        code: 'custom',
        message: 'windowEnd must be after windowStart',
        path: ['windowEnd'],
      });
    }
    if ((p.lunchStart === undefined) !== (p.lunchEnd === undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Set both lunchStart and lunchEnd, or neither',
        path: ['lunchStart'],
      });
    } else if (p.lunchStart && p.lunchEnd && parseTime(p.lunchEnd) <= parseTime(p.lunchStart)) {
      ctx.addIssue({
        code: 'custom',
        message: 'lunchEnd must be after lunchStart',
        path: ['lunchEnd'],
      });
    }
    if (new Set(p.studyWeekdays).size !== p.studyWeekdays.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'studyWeekdays has duplicates',
        path: ['studyWeekdays'],
      });
    }
  });

/** Overrides the weekly pattern for one date ("only 4 hours tomorrow", "add this Friday"). */
export const DayOverrideSchema = z.object({
  date: LocalDateSchema,
  isStudyDay: z.boolean(),
  capacityHours: z.number().min(0).max(24).optional(),
});

/** A time range that blocks study (an accepted, busy calendar event). */
export const BusyIntervalSchema = z
  .object({
    date: LocalDateSchema,
    start: TimeSchema,
    end: TimeSchema,
    title: z.string().optional(),
  })
  .refine((b) => parseTime(b.end) > parseTime(b.start), { message: 'end must be after start' });

export const BlockKindSchema = z.enum(['study', 'anchor', 'pinned', 'locked']);

/** One scheduled block of study time. */
export const BlockSchema = z.object({
  taskId: z.string().min(1),
  date: LocalDateSchema,
  start: TimeSchema,
  end: TimeSchema,
  minutes: z.number().int().positive(),
  kind: BlockKindSchema,
});

/**
 * The plan file format: how a whole plan is imported (the seed plan, a plan built by the plan
 * builder, or a demo plan). Spec 12.3: the seed is a JSON file in this shared format.
 */
export const PlanFileSchema = z.object({
  formatVersion: z.literal(1),
  name: z.string().min(1),
  startDate: LocalDateSchema,
  endDate: LocalDateSchema.optional(),
  weekPattern: WeekPatternSchema,
  overrides: z.array(DayOverrideSchema).default([]),
  tasks: z.array(TaskSchema).min(1),
});

export type TaskType = z.infer<typeof TaskTypeSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type Lesson = z.infer<typeof LessonSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type TaskInput = z.input<typeof TaskSchema>;
export type WeekPattern = z.infer<typeof WeekPatternSchema>;
export type WeekPatternInput = z.input<typeof WeekPatternSchema>;
export type DayOverride = z.infer<typeof DayOverrideSchema>;
export type BusyInterval = z.infer<typeof BusyIntervalSchema>;
export type BlockKind = z.infer<typeof BlockKindSchema>;
export type Block = z.infer<typeof BlockSchema>;
export type PlanFile = z.infer<typeof PlanFileSchema>;
export type PlanFileInput = z.input<typeof PlanFileSchema>;

/** Validates a plan file and checks that every dependency points at a task in the plan. */
export function parsePlanFile(input: unknown): PlanFile {
  const plan = PlanFileSchema.parse(input);
  const ids = new Set<string>();
  for (const task of plan.tasks) {
    if (ids.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
    ids.add(task.id);
  }
  for (const task of plan.tasks) {
    for (const dep of task.dependsOn) {
      if (!ids.has(dep)) throw new Error(`Task ${task.id} depends on unknown task ${dep}`);
    }
  }
  return plan;
}
