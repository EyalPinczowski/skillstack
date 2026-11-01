import { createHash } from 'node:crypto';
import {
  FEEDBACK_BLOCK_INSTRUCTION,
  GENERIC_RUBRIC_STEPS,
  PERSONAS,
  PiiLeakError,
  addDays,
  buildPracticePrompt,
  knownIdentifiersFor,
  localDateOf,
  normalizeEnteredScore,
  parseFeedbackBlock,
  redactPii,
  rubricFeedback,
  trendsByKind,
  type BuiltPracticePrompt,
  type PracticePromptInput,
} from '@skillstack/shared';
import { ZodError } from 'zod';
import type { Database, UserContext } from '../../db/database';
import { HttpError } from '../../errors';
import * as plansRepo from '../plans/repository';
import type { createTaskService } from '../tasks/service';
import type { TaskView } from '../tasks/schemas';
import * as repo from './repository';
import type {
  FeedbackRow,
  MessageRow,
  NewFeedback,
  PromptInputsRecord,
  SessionRow,
} from './repository';
import {
  HISTORY_MAX_LIMIT,
  TREND_SESSION_LIMIT,
  type FeedbackView,
  type FinishBody,
  type MessageView,
  type PasteFeedbackBody,
  type SessionView,
} from './schemas';

export type TaskService = ReturnType<typeof createTaskService>;

const notFound = () => new HttpError(404, 'not_found', 'Resource not found.');
const unprocessable = (message: string) => new HttpError(422, 'unprocessable', message);
const conflict = (message: string, code = 'conflict') => new HttpError(409, code, message);

/** The kind a practice task without a `practiceKind` is stored under. */
export const DEFAULT_KIND = 'general';
/** How many "studied this week" topics a prompt carries. */
const MAX_TOPICS = 10;
/** A week is today and the six days before it (plan-local). */
const TOPIC_WINDOW_DAYS = 6;

/** Cuts to `max` UTF-16 units without leaving half of a surrogate pair. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const high = text.charCodeAt(max - 1);
  return text.slice(0, high >= 0xd800 && high <= 0xdbff ? max - 1 : max);
}

const iso = (d: Date) => d.toISOString();
const minutesBetween = (a: Date, b: Date) =>
  Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));

/**
 * A stable uuid for the one log a session writes, so a retried finish cannot log twice. It is a
 * hash of the session id, not the session id itself, so it does not collide with a log id the
 * client chose (only a deliberate SHA-256 match could; not by accident).
 */
export function sessionLogId(sessionId: string): string {
  const h = createHash('sha256').update(`practice-log:${sessionId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const toMessageView = (m: MessageRow): MessageView => ({
  id: m.id,
  seq: m.seq,
  role: m.role,
  content: m.content,
  providerId: m.providerId,
  model: m.model,
  redacted: m.redacted,
  createdAt: iso(m.createdAt),
});

const toSessionView = (s: SessionRow): SessionView => ({
  id: s.id,
  planId: s.planId,
  taskId: s.taskId,
  kind: s.kind,
  persona: s.persona,
  channel: s.channel,
  status: s.status,
  plannedMinutes: s.plannedMinutes,
  startedAt: iso(s.startedAt),
  endedAt: s.endedAt ? iso(s.endedAt) : null,
  prompt: s.prompt,
  inputs: s.inputs,
});

const toFeedbackView = (f: FeedbackRow): FeedbackView => ({
  source: f.source,
  score: f.score,
  strengths: f.strengths,
  improve: f.improve,
  nextFocus: f.nextFocus,
  raw: f.raw,
  createdAt: iso(f.createdAt),
});

interface Topic {
  id: string;
  title: string;
}

/** What the prompt is built from, besides the task. */
interface Gathered {
  jobDescription: string;
  nextFocus: { sessionId: string; nextFocus: string } | null;
  knownIdentifiers: string[];
}

interface Built {
  /** With the job description: what the user copies. */
  full: BuiltPracticePrompt;
  /** Without it: what a session stores. */
  stored: BuiltPracticePrompt;
}

const kindOf = (task: TaskView) => clip(task.practiceKind?.trim() || DEFAULT_KIND, 100);

/** The allowlisted prompt input for a task, cut to the prompt schema's limits. */
function promptInput(
  task: TaskView,
  topics: Topic[],
  g: Gathered,
  withJobDescription: boolean,
): PracticePromptInput {
  return {
    practiceKind: clip(kindOf(task), 60),
    task: {
      title: clip(task.title, 200),
      ...(task.promptTemplate ? { promptTemplate: clip(task.promptTemplate, 4000) } : {}),
      howToSteps: task.howToSteps.slice(0, 30).map((s) => clip(s, 500)),
      plannedMinutes: Math.min(600, Math.max(1, Math.round(task.estHours * 60))),
    },
    ...(g.nextFocus ? { nextFocus: clip(g.nextFocus.nextFocus, 1000) } : {}),
    weekTopics: topics.map((t) => ({ title: clip(t.title, 200) })),
    ...(withJobDescription && g.jobDescription ? { jobDescription: g.jobDescription } : {}),
  };
}

/** Builds both prompts. A leak or an invalid input is a 422, never a 500, and never echoes text. */
function build(task: TaskView, topics: Topic[], g: Gathered): Built {
  const options = { knownIdentifiers: g.knownIdentifiers };
  try {
    return {
      full: buildPracticePrompt(promptInput(task, topics, g, true), options),
      stored: buildPracticePrompt(promptInput(task, topics, g, false), options),
    };
  } catch (error) {
    if (error instanceof PiiLeakError) {
      throw new HttpError(
        422,
        'pii_blocked',
        'The prompt still contained personal details after removing them. Edit the task text or the job description.',
      );
    }
    if (error instanceof ZodError) {
      throw unprocessable('The task cannot be turned into a practice prompt.');
    }
    throw error;
  }
}

async function gather(
  ctx: UserContext,
  userId: string,
  planId: string,
  kind: string,
): Promise<Gathered> {
  // One after the other: a transaction has a single connection.
  const identity = await repo.getIdentity(ctx, userId);
  const context = await repo.getContext(ctx, userId, planId);
  const nextFocus = await repo.lastNextFocus(ctx, userId, planId, kind);
  return {
    jobDescription: context?.jobDescription ?? '',
    nextFocus,
    knownIdentifiers: knownIdentifiersFor({
      email: identity.email,
      displayName: identity.displayName,
    }),
  };
}

const sameFeedback = (a: FeedbackRow, b: NewFeedback) =>
  a.source === b.source &&
  a.score === b.score &&
  a.strengths === b.strengths &&
  a.improve === b.improve &&
  a.nextFocus === b.nextFocus &&
  a.raw === b.raw;

/** The finish options the two finishing routes share. */
interface Completion {
  markDone: boolean;
  logHours: number | null;
}

interface FinishRequest extends Completion {
  /** The feedback this call brings; null when it brings none. */
  feedback: NewFeedback | null;
  /** Pasted text: its parse result is reported back. */
  parsed?: boolean;
}

export interface FinishResult {
  session: SessionView;
  feedback: FeedbackView | null;
  loggedHours: number | null;
  task: { status: TaskView['status']; doneHours: number };
  replayed: boolean;
  /** Only for pasted feedback. */
  parsed?: boolean;
}

/**
 * Practice sessions without a model (spec 3.3): the job description, the dynamic prompt, sessions
 * on practice tasks, pasted or self-scored feedback, history and trends.
 *
 * Rules this module keeps:
 * - Facts about tasks (type, steps, estimate, status) and every change to them (logging hours,
 *   marking done) go through the tasks service. This module's SQL never reads the tasks table.
 * - A task is marked done only when the request says `markDone: true`, and only by
 *   `completeTask`. Finishing a session otherwise leaves the task status alone.
 * - The job description (Tier 2) lives in practice_contexts. It is never stored in a session's
 *   prompt, an event or a log line.
 * - The user id is the verified caller's. It is never read from a request.
 */
export function createPracticeService(
  db: Database,
  tasks: TaskService,
  now: () => Date = () => new Date(),
) {
  /** The task, or 404; 422 when it is not a practice task. */
  async function practiceTask(userId: string, planId: string, taskId: string): Promise<TaskView> {
    const task = await tasks.getTask(userId, planId, taskId);
    if (task.type !== 'practice') throw unprocessable('This task is not a practice.');
    return task;
  }

  /** The other tasks the user logged time on in the last 7 plan-local days, newest first. */
  async function weekTopics(userId: string, planId: string, taskId: string): Promise<Topic[]> {
    const timezone = await db.withUser(userId, (ctx) =>
      plansRepo.planTimezone(ctx, userId, planId),
    );
    if (!timezone) return [];
    const today = localDateOf(now(), timezone);
    const logs = await tasks.listLogs(userId, planId, addDays(today, -TOPIC_WINDOW_DAYS), today);
    const logged = new Set(logs.map((l) => l.taskId));
    logged.delete(taskId);
    if (logged.size === 0) return [];
    const titles = new Map((await tasks.listTasks(userId, planId)).map((t) => [t.id, t.title]));
    const topics: Topic[] = [];
    const seen = new Set<string>();
    for (const log of [...logs].reverse()) {
      if (!logged.has(log.taskId) || seen.has(log.taskId)) continue;
      const title = titles.get(log.taskId);
      if (title === undefined) continue;
      seen.add(log.taskId);
      topics.push({ id: log.taskId, title });
      if (topics.length === MAX_TOPICS) break;
    }
    return topics;
  }

  async function sessionDetail(ctx: UserContext, userId: string, session: SessionRow) {
    const messages = await repo.listMessages(ctx, userId, session.id);
    const feedback = await repo.getFeedback(ctx, userId, session.id);
    return {
      session: toSessionView(session),
      messages: messages.map(toMessageView),
      feedback: feedback ? toFeedbackView(feedback) : null,
    };
  }

  /** The feedback a finish call brings: a self-check, an entered score, or none. */
  function feedbackFromFinish(task: TaskView, body: FinishBody): NewFeedback | null {
    if (body.rubric) {
      const own = task.howToSteps.some((s) => s.trim().length > 0);
      const steps = own ? task.howToSteps : [...GENERIC_RUBRIC_STEPS];
      const checkedSteps = [...new Set(body.rubric.checkedSteps)];
      if (checkedSteps.some((i) => i >= steps.length)) {
        throw unprocessable('A ticked step is not one of the steps of this practice.');
      }
      const checked = steps.map((_, i) => checkedSteps.includes(i));
      const feedback = rubricFeedback(steps, checked);
      if (!feedback) throw unprocessable('This practice has no steps to score.');
      return {
        source: 'self_rubric',
        score: feedback.score,
        strengths: feedback.strengths,
        improve: feedback.improve,
        nextFocus: feedback.next_focus,
        raw: null,
      };
    }
    if (body.enteredScore) {
      const { score, max } = body.enteredScore;
      const normalised = normalizeEnteredScore(score, max);
      if (normalised === null)
        throw unprocessable('That score cannot be turned into a 0 to 10 score.');
      return {
        source: 'self_rubric',
        score: normalised,
        strengths: `Score you entered: ${score} out of ${max}.`,
        improve: '',
        nextFocus: '',
        raw: null,
      };
    }
    return null;
  }

  /**
   * A session that is already finished. The same request again (same feedback, same options)
   * answers the stored result and changes nothing; anything else is a 409. Nothing is applied on
   * a replay, not even a `markDone` that the first call did not have.
   */
  async function replay(
    ctx: UserContext,
    userId: string,
    session: SessionRow,
    request: FinishRequest,
  ): Promise<Omit<FinishResult, 'task'>> {
    const stored = await repo.getFeedback(ctx, userId, session.id);
    const event = await repo.finishedEventPayload(ctx, userId, session.planId, session.id);
    const hours = request.logHours && request.logHours > 0 ? request.logHours : null;
    const sameOptions =
      event !== null &&
      event.markedDone === request.markDone &&
      (event.loggedHours ?? null) === hours;
    // A call that brings no feedback accepts whatever the session ended with.
    const sameBody =
      request.feedback === null || (stored !== null && sameFeedback(stored, request.feedback));
    if (!sameOptions || !sameBody) {
      throw conflict('This practice was already finished with different feedback or options.');
    }
    return {
      session: toSessionView(session),
      feedback: stored ? toFeedbackView(stored) : null,
      loggedHours: typeof event?.loggedHours === 'number' ? event.loggedHours : null,
      replayed: true,
    };
  }

  /**
   * Finishes a session in ONE transaction, so a finish either happens completely or not at all:
   * 1. lock the session row and confirm it is still active (a racing abandon or second finish
   *    waits here, then sees the final status);
   * 2. through the tasks service, inside this same transaction: the hours log (a fixed id per
   *    session) and, only with `markDone`, `completeTask`;
   * 3. the feedback, the session's end and the `practice.finished` event.
   * Any failure, including a 409 for a conflicting repeat, rolls back every step: no log, no
   * status change, no event. Feedback never marks anything done by itself.
   */
  async function complete(
    userId: string,
    planId: string,
    sessionId: string,
    prepare: (task: TaskView) => FinishRequest,
  ): Promise<FinishResult> {
    // Only to read the task's steps for a rubric; the facts that decide anything are re-read
    // under the lock below.
    const taskId = await db.withUser(userId, async (ctx) => {
      const found = await repo.getSession(ctx, userId, planId, sessionId);
      if (!found) throw notFound();
      return found.taskId;
    });
    const request = prepare(await tasks.getTask(userId, planId, taskId));
    const hours = request.logHours && request.logHours > 0 ? request.logHours : null;
    const result = (r: Omit<FinishResult, 'task'>, t: TaskView): FinishResult => ({
      ...r,
      task: { status: t.status, doneHours: t.doneHours },
      ...(request.parsed === undefined ? {} : { parsed: request.parsed }),
    });

    return db.withUser(userId, async (ctx) => {
      const session = await repo.getSession(ctx, userId, planId, sessionId, true);
      if (!session) throw notFound();
      if (session.status === 'abandoned') throw conflict('This practice was abandoned.');
      let current = await tasks.getTaskIn(ctx, userId, planId, session.taskId);
      if (session.status === 'finished') {
        return result(await replay(ctx, userId, session, request), current);
      }
      if (request.markDone && current.status === 'skipped') {
        throw conflict('Reopen the task before marking it done.');
      }

      if (hours !== null) {
        const timezone = (await plansRepo.planTimezone(ctx, userId, planId)) ?? 'UTC';
        const logged = await tasks.addLogIn(ctx, userId, planId, session.taskId, {
          id: sessionLogId(session.id),
          date: localDateOf(session.startedAt, timezone),
          hours,
        });
        current = logged.task;
      }
      if (request.markDone) {
        current = await tasks.completeTaskIn(ctx, userId, planId, session.taskId);
      }

      const endedAt = now();
      const feedback = request.feedback
        ? await repo.insertFeedback(ctx, userId, sessionId, request.feedback, endedAt)
        : null;
      const ended = await repo.endSession(ctx, userId, planId, sessionId, 'finished', endedAt);
      await plansRepo.insertEvent(ctx, userId, planId, 'practice.finished', {
        sessionId,
        taskId: ended.taskId,
        kind: ended.kind,
        source: feedback?.source ?? null,
        score: feedback?.score ?? null,
        minutes: minutesBetween(ended.startedAt, ended.endedAt ?? endedAt),
        markedDone: request.markDone,
        loggedHours: hours,
      });
      return result(
        {
          session: toSessionView(ended),
          feedback: feedback ? toFeedbackView(feedback) : null,
          loggedHours: hours,
          replayed: false,
        },
        current,
      );
    });
  }

  return {
    // -- context ------------------------------------------------------------------------------

    getContext: (userId: string, planId: string) =>
      db.withUser(userId, async (ctx) => {
        if (!(await plansRepo.planExists(ctx, userId, planId))) throw notFound();
        const row = await repo.getContext(ctx, userId, planId);
        return {
          jobDescription: row?.jobDescription ?? '',
          updatedAt: row ? iso(row.updatedAt) : null,
        };
      }),

    putContext: (userId: string, planId: string, jobDescription: string) =>
      db.withUser(userId, async (ctx) => {
        if (!(await plansRepo.planExists(ctx, userId, planId))) throw notFound();
        const identity = await repo.getIdentity(ctx, userId);
        const updatedAt = await repo.upsertContext(ctx, userId, planId, jobDescription, now());
        const { count } = redactPii(jobDescription, {
          knownIdentifiers: knownIdentifiersFor({
            email: identity.email,
            displayName: identity.displayName,
          }),
        });
        return { jobDescription, updatedAt: iso(updatedAt), redactionsPreview: count };
      }),

    // -- prompt -------------------------------------------------------------------------------

    prompt: async (userId: string, planId: string, taskId: string) => {
      const task = await practiceTask(userId, planId, taskId);
      const topics = await weekTopics(userId, planId, taskId);
      return db.withUser(userId, async (ctx) => {
        const g = await gather(ctx, userId, planId, kindOf(task));
        const { full } = build(task, topics, g);
        return {
          persona: { id: full.personaId, label: PERSONAS[full.personaId].label },
          prompt: full.copyText,
          inputs: {
            nextFocus: g.nextFocus?.nextFocus ?? null,
            nextFocusFrom: g.nextFocus?.sessionId ?? null,
            topics: topics.map((t) => t.title),
            jobDescriptionIncluded: g.jobDescription.length > 0,
            redactions: full.redactions,
          },
          feedbackFormat: FEEDBACK_BLOCK_INSTRUCTION,
        };
      });
    },

    // -- sessions -----------------------------------------------------------------------------

    /**
     * Idempotent on the client's session id: the same id with the same task and channel answers
     * the stored session (`created: false`); the same id for anything else is a 409, and so is a
     * second active session on the task. The stored prompt never holds the job description.
     */
    createSession: async (
      userId: string,
      planId: string,
      taskId: string,
      input: { id: string; channel: 'external' | 'self' },
    ) => {
      const task = await practiceTask(userId, planId, taskId);
      const topics = await weekTopics(userId, planId, taskId);
      return db.withUser(userId, async (ctx) => {
        // One writer per plan at a time, so "one active session per task" cannot race.
        if (!(await plansRepo.lockPlan(ctx, userId, planId))) throw notFound();
        const existing = await repo.getSessionById(ctx, userId, input.id);
        if (existing) {
          if (
            existing.planId !== planId ||
            existing.taskId !== taskId ||
            existing.channel !== input.channel
          ) {
            throw conflict('This session id was already used for different data.');
          }
          return {
            created: false,
            session: toSessionView(existing),
            messages: (await repo.listMessages(ctx, userId, existing.id)).map(toMessageView),
          };
        }
        const active = await repo.activeSessionId(ctx, userId, planId, taskId);
        if (active) {
          throw conflict(
            `This task already has an active practice session (${active}).`,
            'practice_session_active',
          );
        }
        const kind = kindOf(task);
        const g = await gather(ctx, userId, planId, kind);
        const { stored } = build(task, topics, g);
        const inputs: PromptInputsRecord = {
          nextFocusFromSession: g.nextFocus?.sessionId ?? null,
          topicTaskIds: topics.map((t) => t.id),
          jobDescriptionIncluded: g.jobDescription.length > 0,
          redactions: stored.redactions,
        };
        const created = await repo
          .insertSession(ctx, userId, {
            id: input.id,
            planId,
            taskId,
            kind,
            persona: stored.personaId,
            channel: input.channel,
            plannedMinutes: Math.min(1440, Math.max(1, Math.round(task.estHours * 60))),
            startedAt: now(),
            prompt: stored.copyText,
            inputs,
          })
          .catch((error: unknown) => {
            // The plan lock above makes this unreachable; the unique index is the backstop.
            const pg = error as { code?: string; constraint?: string };
            if (pg.code === '23505' && pg.constraint === 'practice_sessions_one_active_idx') {
              throw conflict(
                'This task already has an active practice session.',
                'practice_session_active',
              );
            }
            throw error;
          });
        await plansRepo.insertEvent(ctx, userId, planId, 'practice.started', {
          sessionId: created.id,
          taskId,
          kind,
          channel: created.channel,
        });
        return { created: true, session: toSessionView(created), messages: [] as MessageView[] };
      });
    },

    getSession: (userId: string, planId: string, sessionId: string) =>
      db.withUser(userId, async (ctx) => {
        const session = await repo.getSession(ctx, userId, planId, sessionId);
        if (!session) throw notFound();
        return sessionDetail(ctx, userId, session);
      }),

    /**
     * Saves a pasted feedback block (or plain text, which is kept as free text with no error) and
     * finishes the session in the same call, with the same `markDone` and `logHours` options as
     * `finish`. Pasted feedback replaces a self-check: this call carries no rubric.
     */
    pasteFeedback: (userId: string, planId: string, sessionId: string, body: PasteFeedbackBody) => {
      const parsed = parseFeedbackBlock(body.text);
      const feedback: NewFeedback = parsed.ok
        ? {
            source: 'pasted_block',
            score: parsed.feedback.score,
            strengths: parsed.feedback.strengths,
            improve: parsed.feedback.improve,
            nextFocus: parsed.feedback.next_focus,
            raw: body.text,
          }
        : {
            source: 'free_text',
            score: null,
            strengths: '',
            improve: '',
            nextFocus: '',
            raw: body.text,
          };
      return complete(userId, planId, sessionId, () => ({
        markDone: body.markDone,
        logHours: body.logHours,
        feedback,
        parsed: parsed.ok,
      }));
    },

    /** Finishes with a self-check, an entered score, or no feedback at all. */
    finish: (userId: string, planId: string, sessionId: string, body: FinishBody) =>
      complete(userId, planId, sessionId, (task) => ({
        markDone: body.markDone,
        logHours: body.logHours,
        feedback: feedbackFromFinish(task, body),
      })),

    /** Active to abandoned: nothing is logged and no event is written. Idempotent. */
    abandon: (userId: string, planId: string, sessionId: string) =>
      db.withUser(userId, async (ctx) => {
        const session = await repo.getSession(ctx, userId, planId, sessionId, true);
        if (!session) throw notFound();
        if (session.status === 'finished') throw conflict('This practice is already finished.');
        if (session.status === 'abandoned') return { session: toSessionView(session) };
        const ended = await repo.endSession(ctx, userId, planId, sessionId, 'abandoned', now());
        return { session: toSessionView(ended) };
      }),

    // -- history and trends -------------------------------------------------------------------

    history: (
      userId: string,
      planId: string,
      q: {
        kind?: string | undefined;
        from?: string | undefined;
        to?: string | undefined;
        limit: number;
      },
    ) =>
      db.withUser(userId, async (ctx) => {
        if (!(await plansRepo.planExists(ctx, userId, planId))) throw notFound();
        const timezone = (await plansRepo.planTimezone(ctx, userId, planId)) ?? 'UTC';
        const rows = await repo.listFinished(ctx, userId, planId, {
          ...q,
          limit: Math.min(q.limit, HISTORY_MAX_LIMIT),
          scoredOnly: false,
          timezone,
        });
        return {
          sessions: rows.map((r) => ({
            id: r.id,
            taskId: r.taskId,
            kind: r.kind,
            channel: r.channel,
            startedAt: iso(r.startedAt),
            minutes: minutesBetween(r.startedAt, r.endedAt),
            score: r.score,
            source: r.source,
          })),
        };
      }),

    /** Score points per kind, oldest first; the summary numbers come from the shared code. */
    trends: (
      userId: string,
      planId: string,
      q: { from?: string | undefined; to?: string | undefined },
    ) =>
      db.withUser(userId, async (ctx) => {
        if (!(await plansRepo.planExists(ctx, userId, planId))) throw notFound();
        const timezone = (await plansRepo.planTimezone(ctx, userId, planId)) ?? 'UTC';
        const newestFirst = await repo.listFinished(ctx, userId, planId, {
          ...q,
          limit: TREND_SESSION_LIMIT,
          scoredOnly: true,
          timezone,
        });
        const rows = [...newestFirst].reverse();
        const summaries = trendsByKind(
          rows.map((r) => ({ practiceKind: r.kind, score: r.score, at: iso(r.startedAt) })),
        );
        return {
          kinds: summaries.map((s) => ({
            kind: s.practiceKind,
            points: rows
              .filter((r) => r.kind === s.practiceKind && r.score !== null && r.source !== null)
              .map((r) => ({ date: r.localDate, score: r.score as number, source: r.source! })),
            last: s.last,
            average: s.average,
            delta: s.delta,
          })),
        };
      }),
  };
}

export type PracticeService = ReturnType<typeof createPracticeService>;
