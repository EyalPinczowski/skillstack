import {
  AdjustmentRuleSchema,
  DayReviewInputSchema,
  LocalDateSchema,
  ProposedChangeSchema,
  SuggestionSchema,
  TaskOutcomeSchema,
} from '@skillstack/shared';
import { z } from 'zod';
import { noNulCharacters } from '../../validation';

export const reviewParams = z.object({ planId: z.uuid(), date: LocalDateSchema });
export const plansParams = z.object({ planId: z.uuid() });

/** The engine's ids are `sg_` plus hex; only token characters are accepted (linear check). */
export const suggestionParams = z.object({
  planId: z.uuid(),
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/),
});

/** The highest option index a suggestion can have (the recommended change plus alternatives). */
export const MAX_OPTION = 9;

const optionSchema = z.coerce.number().int().min(0).max(MAX_OPTION);

/** Preview and accept choose an option by number; the change itself is always computed here. */
export const previewQuery = z.object({ option: optionSchema.default(0) });
export const acceptBody = noNulCharacters(
  z.strictObject({ option: optionSchema.default(0) }),
).nullish();
export const rejectBody = noNulCharacters(z.strictObject({})).nullish();

/** The review body: the shared schema plus the NUL check on the note, reasons and task ids. */
export const putReviewBody = noNulCharacters(DayReviewInputSchema);

export const historyQuery = z
  .object({ from: LocalDateSchema.optional(), to: LocalDateSchema.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'from must not be after to' });

export const reviewView = z.object({
  date: LocalDateSchema,
  difficulty: z.number().int(),
  density: z.number().int(),
  energy: z.number().int(),
  note: z.string(),
  outcomes: z.array(TaskOutcomeSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ReviewView = z.infer<typeof reviewView>;

/** One point of the trend chart (spec 3.4): the ratings only, no note and no outcomes. */
export const reviewPoint = z.object({
  date: LocalDateSchema,
  difficulty: z.number().int(),
  density: z.number().int(),
  energy: z.number().int(),
});
export const reviewHistory = z.object({ reviews: z.array(reviewPoint) });

export const missingLog = z.object({
  taskId: z.string(),
  reportedHours: z.number(),
  loggedHours: z.number(),
  missingHours: z.number(),
});

export const suggestionList = z.object({
  today: LocalDateSchema,
  suggestions: z.array(SuggestionSchema),
});

export const putReviewResult = z.object({
  review: reviewView,
  /** True when this call stored the review for the first time. */
  created: z.boolean(),
  /**
   * Partial outcomes whose reported hours are not all logged yet. The app never logs them: the
   * user does that with the log endpoint.
   */
  missingLogs: z.array(missingLog),
  /** Tasks reported as done that are not marked done yet. The user marks them. */
  notMarkedDone: z.array(z.string()),
  /** Suggestions that are open after this review (nothing is saved for them). */
  suggestions: z.array(SuggestionSchema),
});

export const changeSummary = z.object({
  movedTaskIds: z.array(z.string()),
  finishBefore: LocalDateSchema.nullable(),
  finishAfter: LocalDateSchema.nullable(),
  finishChanged: z.boolean(),
  finishShiftStudyDays: z.number().int(),
  newAnchorRisks: z.array(z.string()),
  text: z.string(),
});

export const suggestionPreview = z.object({
  suggestionId: z.string(),
  option: z.number().int(),
  change: ProposedChangeSchema,
  summary: changeSummary,
  currentFinishDate: LocalDateSchema.nullable(),
  proposedFinishDate: LocalDateSchema.nullable(),
});

export const adjustmentView = z.object({
  suggestionId: z.string(),
  rule: AdjustmentRuleSchema,
  status: z.enum(['accepted', 'rejected']),
  option: z.number().int().nullable(),
  decidedAt: z.iso.datetime(),
});
export type AdjustmentView = z.infer<typeof adjustmentView>;

export const decisionResult = z.object({
  adjustment: adjustmentView,
  /** The change summary shown when the suggestion was accepted; null for a rejection. */
  summary: changeSummary.nullable(),
  /** True when the decision had been made before and nothing was changed by this call. */
  replayed: z.boolean(),
});
