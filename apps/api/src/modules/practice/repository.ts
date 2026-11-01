import type { UserContext } from '../../db/database';

/**
 * SQL for the four practice tables (and the user's own name, to hide it from prompts). Nothing
 * here touches the tasks table: task facts come from the tasks service. Every query takes the
 * user id from the verified caller and runs inside db.withUser (row-level security).
 */

export type Channel = 'in_app' | 'external' | 'self';
export type SessionStatus = 'active' | 'finished' | 'abandoned';
export type FeedbackSource =
  'model_json' | 'model_repaired' | 'pasted_block' | 'free_text' | 'self_rubric';

export interface PromptInputsRecord {
  nextFocusFromSession: string | null;
  topicTaskIds: string[];
  jobDescriptionIncluded: boolean;
  redactions: number;
}

export interface SessionRow {
  id: string;
  planId: string;
  taskId: string;
  kind: string;
  persona: string;
  channel: Channel;
  status: SessionStatus;
  plannedMinutes: number;
  startedAt: Date;
  endedAt: Date | null;
  prompt: string;
  inputs: PromptInputsRecord;
}

interface RawSession {
  id: string;
  plan_id: string;
  task_id: string;
  practice_kind: string;
  persona: string;
  channel: Channel;
  status: SessionStatus;
  planned_minutes: number;
  started_at: Date;
  ended_at: Date | null;
  prompt_used: string;
  prompt_inputs: PromptInputsRecord;
}

const SESSION_COLUMNS = `id, plan_id, task_id, practice_kind, persona, channel, status,
  planned_minutes, started_at, ended_at, prompt_used, prompt_inputs`;

const toSession = (r: RawSession): SessionRow => ({
  id: r.id,
  planId: r.plan_id,
  taskId: r.task_id,
  kind: r.practice_kind,
  persona: r.persona,
  channel: r.channel,
  status: r.status,
  plannedMinutes: r.planned_minutes,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  prompt: r.prompt_used,
  inputs: r.prompt_inputs,
});

// ---------------------------------------------------------------------------
// The user's own identifiers, so prompts never carry them
// ---------------------------------------------------------------------------

export async function getIdentity(
  ctx: UserContext,
  userId: string,
): Promise<{ email: string; displayName: string | null }> {
  const { rows } = await ctx.client.query<{ email: string; display_name: string | null }>(
    `select email, display_name from ${ctx.schema}.app_users where id = $1`,
    [userId],
  );
  return { email: rows[0]?.email ?? '', displayName: rows[0]?.display_name ?? null };
}

// ---------------------------------------------------------------------------
// Context (the job description, Tier 2)
// ---------------------------------------------------------------------------

export async function getContext(
  ctx: UserContext,
  userId: string,
  planId: string,
): Promise<{ jobDescription: string; updatedAt: Date } | null> {
  const { rows } = await ctx.client.query<{ job_description: string; updated_at: Date }>(
    `select job_description, updated_at from ${ctx.schema}.practice_contexts
     where user_id = $1 and plan_id = $2`,
    [userId, planId],
  );
  return rows[0]
    ? { jobDescription: rows[0].job_description, updatedAt: rows[0].updated_at }
    : null;
}

export async function upsertContext(
  ctx: UserContext,
  userId: string,
  planId: string,
  jobDescription: string,
  at: Date,
): Promise<Date> {
  const { rows } = await ctx.client.query<{ updated_at: Date }>(
    `insert into ${ctx.schema}.practice_contexts (user_id, plan_id, job_description, updated_at)
     values ($1, $2, $3, $4)
     on conflict (user_id, plan_id)
     do update set job_description = excluded.job_description, updated_at = excluded.updated_at
     returning updated_at`,
    [userId, planId, jobDescription, at],
  );
  return rows[0]!.updated_at;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function getSession(
  ctx: UserContext,
  userId: string,
  planId: string,
  sessionId: string,
  lock = false,
): Promise<SessionRow | null> {
  const { rows } = await ctx.client.query<RawSession>(
    `select ${SESSION_COLUMNS} from ${ctx.schema}.practice_sessions
     where user_id = $1 and plan_id = $2 and id = $3${lock ? ' for no key update' : ''}`,
    [userId, planId, sessionId],
  );
  return rows[0] ? toSession(rows[0]) : null;
}

/** A session by id whatever its plan (used to tell a retried create from a reused id). */
export async function getSessionById(
  ctx: UserContext,
  userId: string,
  sessionId: string,
): Promise<SessionRow | null> {
  const { rows } = await ctx.client.query<RawSession>(
    `select ${SESSION_COLUMNS} from ${ctx.schema}.practice_sessions
     where user_id = $1 and id = $2`,
    [userId, sessionId],
  );
  return rows[0] ? toSession(rows[0]) : null;
}

export async function activeSessionId(
  ctx: UserContext,
  userId: string,
  planId: string,
  taskId: string,
): Promise<string | null> {
  const { rows } = await ctx.client.query<{ id: string }>(
    `select id from ${ctx.schema}.practice_sessions
     where user_id = $1 and plan_id = $2 and task_id = $3 and status = 'active'`,
    [userId, planId, taskId],
  );
  return rows[0]?.id ?? null;
}

export interface NewSession {
  id: string;
  planId: string;
  taskId: string;
  kind: string;
  persona: string;
  channel: Channel;
  plannedMinutes: number;
  startedAt: Date;
  prompt: string;
  inputs: PromptInputsRecord;
}

export async function insertSession(
  ctx: UserContext,
  userId: string,
  s: NewSession,
): Promise<SessionRow> {
  const { rows } = await ctx.client.query<RawSession>(
    `insert into ${ctx.schema}.practice_sessions
       (user_id, id, plan_id, task_id, practice_kind, persona, channel, planned_minutes,
        started_at, prompt_used, prompt_inputs)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     returning ${SESSION_COLUMNS}`,
    [
      userId,
      s.id,
      s.planId,
      s.taskId,
      s.kind,
      s.persona,
      s.channel,
      s.plannedMinutes,
      s.startedAt,
      s.prompt,
      JSON.stringify(s.inputs),
    ],
  );
  return toSession(rows[0]!);
}

/** active to finished or abandoned. The database refuses any other change of status. */
export async function endSession(
  ctx: UserContext,
  userId: string,
  planId: string,
  sessionId: string,
  status: 'finished' | 'abandoned',
  at: Date,
): Promise<SessionRow> {
  const { rows } = await ctx.client.query<RawSession>(
    `update ${ctx.schema}.practice_sessions
     set status = $4, ended_at = greatest($5::timestamptz, started_at)
     where user_id = $1 and plan_id = $2 and id = $3
     returning ${SESSION_COLUMNS}`,
    [userId, planId, sessionId, status, at],
  );
  return toSession(rows[0]!);
}

/** The newest finished session of this kind in the plan that left a next focus, if any. */
export async function lastNextFocus(
  ctx: UserContext,
  userId: string,
  planId: string,
  kind: string,
): Promise<{ sessionId: string; nextFocus: string } | null> {
  const { rows } = await ctx.client.query<{ id: string; next_focus: string }>(
    `select s.id, f.next_focus
     from ${ctx.schema}.practice_sessions s
     join ${ctx.schema}.practice_feedback f on f.user_id = s.user_id and f.session_id = s.id
     where s.user_id = $1 and s.plan_id = $2 and s.practice_kind = $3 and s.status = 'finished'
       and btrim(f.next_focus) <> ''
     order by s.ended_at desc, s.started_at desc, s.id
     limit 1`,
    [userId, planId, kind],
  );
  return rows[0] ? { sessionId: rows[0].id, nextFocus: rows[0].next_focus } : null;
}

// ---------------------------------------------------------------------------
// Messages and feedback
// ---------------------------------------------------------------------------

export interface MessageRow {
  id: string;
  seq: number;
  role: 'user' | 'assistant' | 'note';
  content: string;
  providerId: string | null;
  model: string | null;
  redacted: boolean;
  createdAt: Date;
}

export async function listMessages(
  ctx: UserContext,
  userId: string,
  sessionId: string,
): Promise<MessageRow[]> {
  const { rows } = await ctx.client.query<{
    id: string;
    seq: number;
    role: MessageRow['role'];
    content: string;
    provider_id: string | null;
    model: string | null;
    redacted: boolean;
    created_at: Date;
  }>(
    `select id, seq, role, content, provider_id, model, redacted, created_at
     from ${ctx.schema}.practice_messages
     where user_id = $1 and session_id = $2 order by seq`,
    [userId, sessionId],
  );
  return rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    role: r.role,
    content: r.content,
    providerId: r.provider_id,
    model: r.model,
    redacted: r.redacted,
    createdAt: r.created_at,
  }));
}

export interface FeedbackRow {
  source: FeedbackSource;
  score: number | null;
  strengths: string;
  improve: string;
  nextFocus: string;
  raw: string | null;
  createdAt: Date;
}

const FEEDBACK_COLUMNS = `source, score::float8 as score, strengths, improve, next_focus, raw, created_at`;

interface RawFeedback {
  source: FeedbackSource;
  score: number | null;
  strengths: string;
  improve: string;
  next_focus: string;
  raw: string | null;
  created_at: Date;
}

const toFeedback = (r: RawFeedback): FeedbackRow => ({
  source: r.source,
  score: r.score,
  strengths: r.strengths,
  improve: r.improve,
  nextFocus: r.next_focus,
  raw: r.raw,
  createdAt: r.created_at,
});

export async function getFeedback(
  ctx: UserContext,
  userId: string,
  sessionId: string,
): Promise<FeedbackRow | null> {
  const { rows } = await ctx.client.query<RawFeedback>(
    `select ${FEEDBACK_COLUMNS} from ${ctx.schema}.practice_feedback
     where user_id = $1 and session_id = $2`,
    [userId, sessionId],
  );
  return rows[0] ? toFeedback(rows[0]) : null;
}

export type NewFeedback = Omit<FeedbackRow, 'createdAt'>;

export async function insertFeedback(
  ctx: UserContext,
  userId: string,
  sessionId: string,
  f: NewFeedback,
  at: Date,
): Promise<FeedbackRow> {
  const { rows } = await ctx.client.query<RawFeedback>(
    `insert into ${ctx.schema}.practice_feedback
       (user_id, session_id, source, score, strengths, improve, next_focus, raw, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning ${FEEDBACK_COLUMNS}`,
    [userId, sessionId, f.source, f.score, f.strengths, f.improve, f.nextFocus, f.raw, at],
  );
  return toFeedback(rows[0]!);
}

/** What the `practice.finished` event of a session recorded (no text), for replay checks. */
export async function finishedEventPayload(
  ctx: UserContext,
  userId: string,
  planId: string,
  sessionId: string,
): Promise<Record<string, unknown> | null> {
  const { rows } = await ctx.client.query<{ payload: Record<string, unknown> }>(
    `select payload from ${ctx.schema}.events
     where user_id = $1 and plan_id = $2 and type = 'practice.finished'
       and payload ->> 'sessionId' = $3
     order by created_at, id limit 1`,
    [userId, planId, sessionId],
  );
  return rows[0]?.payload ?? null;
}

// ---------------------------------------------------------------------------
// History and trends (no text leaves here)
// ---------------------------------------------------------------------------

export interface HistoryRow {
  id: string;
  taskId: string;
  kind: string;
  channel: Channel;
  startedAt: Date;
  endedAt: Date;
  localDate: string;
  score: number | null;
  source: FeedbackSource | null;
}

export interface HistoryFilter {
  kind?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  /** Only sessions with a score. */
  scoredOnly: boolean;
  limit: number;
  /** The plan's zone, to turn start times into plan-local dates. */
  timezone: string;
}

/** Finished sessions, newest first. */
export async function listFinished(
  ctx: UserContext,
  userId: string,
  planId: string,
  f: HistoryFilter,
): Promise<HistoryRow[]> {
  const { rows } = await ctx.client.query<{
    id: string;
    task_id: string;
    practice_kind: string;
    channel: Channel;
    started_at: Date;
    ended_at: Date;
    local_date: string;
    score: number | null;
    source: FeedbackSource | null;
  }>(
    `select s.id, s.task_id, s.practice_kind, s.channel, s.started_at, s.ended_at,
            ((s.started_at at time zone $7::text)::date)::text as local_date,
            f.score::float8 as score, f.source
     from ${ctx.schema}.practice_sessions s
     left join ${ctx.schema}.practice_feedback f
       on f.user_id = s.user_id and f.session_id = s.id
     where s.user_id = $1 and s.plan_id = $2 and s.status = 'finished'
       and ($3::text is null or s.practice_kind = $3::text)
       and ($4::date is null or (s.started_at at time zone $7::text)::date >= $4::date)
       and ($5::date is null or (s.started_at at time zone $7::text)::date <= $5::date)
       and (not $8::boolean or f.score is not null)
     order by s.started_at desc, s.id
     limit $6`,
    [
      userId,
      planId,
      f.kind ?? null,
      f.from ?? null,
      f.to ?? null,
      f.limit,
      f.timezone,
      f.scoredOnly,
    ],
  );
  return rows.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    kind: r.practice_kind,
    channel: r.channel,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    localDate: r.local_date,
    score: r.score,
    source: r.source,
  }));
}
