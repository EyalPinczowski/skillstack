import { LocalDateSchema } from '@skillstack/shared';
import { z } from 'zod';
import { noNulCharacters } from '../../validation';

export const MAX_JOB_DESCRIPTION_LENGTH = 8000;
export const MAX_PASTED_FEEDBACK_LENGTH = 20_000;
export const MAX_LOG_HOURS = 12;
export const HISTORY_DEFAULT_LIMIT = 50;
export const HISTORY_MAX_LIMIT = 200;
/** Trends read at most this many of the newest scored sessions. */
export const TREND_SESSION_LIMIT = 1000;

export const planParams = z.object({ planId: z.uuid() });
export const taskParams = noNulCharacters(
  z.object({ planId: z.uuid(), taskId: z.string().min(1).max(200) }),
);
export const sessionParams = z.object({ planId: z.uuid(), sessionId: z.uuid() });

const ts = z.iso.datetime();
const source = z.enum(['model_json', 'model_repaired', 'pasted_block', 'free_text', 'self_rubric']);
const channel = z.enum(['in_app', 'external', 'self']);

// ---------------------------------------------------------------------------
// Context (the job description)
// ---------------------------------------------------------------------------

export const contextView = z.object({
  jobDescription: z.string(),
  /** Null until the user saves one. */
  updatedAt: ts.nullable(),
});

export const putContextBody = noNulCharacters(
  z.strictObject({ jobDescription: z.string().max(MAX_JOB_DESCRIPTION_LENGTH) }),
);

export const putContextResult = z.object({
  jobDescription: z.string(),
  updatedAt: ts,
  /** How many personal details (emails, phones, links, your own name) are removed before any model sees the text. */
  redactionsPreview: z.number().int().min(0),
});

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export const promptView = z.object({
  persona: z.object({ id: z.string(), label: z.string() }),
  /** The text to copy: persona, task, the user's inputs and the feedback-block instruction. */
  prompt: z.string(),
  inputs: z.object({
    nextFocus: z.string().nullable(),
    /** The finished session the focus came from. */
    nextFocusFrom: z.uuid().nullable(),
    /** Titles of the other tasks worked on in the last 7 days (plan-local). */
    topics: z.array(z.string()),
    jobDescriptionIncluded: z.boolean(),
    /** Personal details removed while building. */
    redactions: z.number().int().min(0),
  }),
  /** The block format the pasted-back feedback must follow. */
  feedbackFormat: z.string(),
});

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** `in_app` joins in the chat package; this package has no model. */
export const CHANNELS = ['external', 'self'] as const;

export const createSessionBody = noNulCharacters(
  z.strictObject({
    /** Chosen by the client, so a retried request cannot create a second session. */
    id: z.uuid(),
    channel: z.enum(CHANNELS),
  }),
);

export const sessionView = z.object({
  id: z.uuid(),
  planId: z.uuid(),
  taskId: z.string(),
  kind: z.string(),
  persona: z.string(),
  channel,
  status: z.enum(['active', 'finished', 'abandoned']),
  plannedMinutes: z.number().int(),
  startedAt: ts,
  endedAt: ts.nullable(),
  /** The built prompt without the job description and without personal details. */
  prompt: z.string(),
  inputs: z.object({
    nextFocusFromSession: z.uuid().nullable(),
    topicTaskIds: z.array(z.string()),
    jobDescriptionIncluded: z.boolean(),
    redactions: z.number().int().min(0),
  }),
});
export type SessionView = z.infer<typeof sessionView>;

export const messageView = z.object({
  id: z.uuid(),
  seq: z.number().int(),
  role: z.enum(['user', 'assistant', 'note']),
  content: z.string(),
  providerId: z.string().nullable(),
  model: z.string().nullable(),
  redacted: z.boolean(),
  createdAt: ts,
});
export type MessageView = z.infer<typeof messageView>;

export const feedbackView = z.object({
  source,
  /** 0 to 10; null for free text, which has no score. */
  score: z.number().nullable(),
  strengths: z.string(),
  improve: z.string(),
  nextFocus: z.string(),
  /** The pasted text as sent (pasted blocks and free text only). */
  raw: z.string().nullable(),
  createdAt: ts,
});
export type FeedbackView = z.infer<typeof feedbackView>;

export const createSessionResult = z.object({
  session: sessionView,
  messages: z.array(messageView),
});

export const sessionDetail = z.object({
  session: sessionView,
  messages: z.array(messageView),
  feedback: feedbackView.nullable(),
});

const taskState = z.object({
  status: z.enum(['pending', 'in_progress', 'done', 'skipped']),
  doneHours: z.number(),
});

const logHoursField = z.number().min(0).max(MAX_LOG_HOURS).nullable().default(null);

export const finishBody = noNulCharacters(
  z
    .strictObject({
      /** The user's explicit choice. Without it the task status is never touched. */
      markDone: z.boolean(),
      /** Hours to log on the task, 0 to 12; null or 0 logs nothing. */
      logHours: logHoursField,
      /** Self-check: the indexes of the ticked steps (the task's steps, or four generic ones). */
      rubric: z
        .strictObject({ checkedSteps: z.array(z.number().int().min(0).max(999)).max(1000) })
        .optional(),
      /** A score you got elsewhere (for example a timed test): `score` out of `max`. */
      enteredScore: z
        .strictObject({
          score: z.number().min(0).max(1_000_000),
          max: z.number().gt(0).max(1_000_000),
        })
        .optional(),
    })
    .refine((b) => !(b.rubric && b.enteredScore), {
      message: 'Send either a rubric or an entered score, not both.',
    }),
);
export type FinishBody = z.infer<typeof finishBody>;

export const pasteFeedbackBody = noNulCharacters(
  z.strictObject({
    text: z.string().trim().min(1).max(MAX_PASTED_FEEDBACK_LENGTH),
    markDone: z.boolean().default(false),
    logHours: logHoursField,
  }),
);
export type PasteFeedbackBody = z.infer<typeof pasteFeedbackBody>;

export const finishResult = z.object({
  session: sessionView,
  feedback: feedbackView.nullable(),
  /** The hours logged on the task by this session; null when none were. */
  loggedHours: z.number().nullable(),
  task: taskState,
  /** True when the session had already been finished with the same options. */
  replayed: z.boolean(),
});

export const pasteFeedbackResult = finishResult.extend({
  /** True when a `===FEEDBACK===` block was read; false when the text was saved as plain text. */
  parsed: z.boolean(),
});

export const abandonResult = z.object({ session: sessionView });

// ---------------------------------------------------------------------------
// History and trends
// ---------------------------------------------------------------------------

export const historyQuery = z
  .object({
    kind: z.string().min(1).max(100).optional(),
    from: LocalDateSchema.optional(),
    to: LocalDateSchema.optional(),
    limit: z.coerce.number().int().min(1).max(HISTORY_MAX_LIMIT).default(HISTORY_DEFAULT_LIMIT),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'from must not be after to' });

export const historyView = z.object({
  sessions: z.array(
    z.object({
      id: z.uuid(),
      taskId: z.string(),
      kind: z.string(),
      channel,
      startedAt: ts,
      minutes: z.number().int(),
      score: z.number().nullable(),
      source: source.nullable(),
    }),
  ),
});

export const trendsQuery = z
  .object({ from: LocalDateSchema.optional(), to: LocalDateSchema.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'from must not be after to' });

export const trendsView = z.object({
  kinds: z.array(
    z.object({
      kind: z.string(),
      points: z.array(
        z.object({
          /** The plan-local day the session started. */
          date: LocalDateSchema,
          score: z.number(),
          source,
        }),
      ),
      last: z.number(),
      average: z.number(),
      /** Last score minus the one before it; null with a single score. */
      delta: z.number().nullable(),
    }),
  ),
});
