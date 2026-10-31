import type {
  AdjustmentRule,
  ChangeSummary,
  DayReview,
  DecidedSuggestion,
  ProposedChange,
  SuggestionEvidence,
  TaskOutcome,
} from '@skillstack/shared';
import type { UserContext } from '../../db/database';

export interface StoredReview extends DayReview {
  createdAt: Date;
  updatedAt: Date;
}

interface ReviewRow {
  date: string;
  difficulty: number;
  density: number;
  energy: number;
  note: string;
  outcomes: TaskOutcome[];
  created_at: Date;
  updated_at: Date;
}

const REVIEW_COLUMNS = 'date, difficulty, density, energy, note, outcomes, created_at, updated_at';

const toReview = (r: ReviewRow): StoredReview => ({
  date: r.date,
  difficulty: r.difficulty,
  density: r.density,
  energy: r.energy,
  note: r.note,
  outcomes: r.outcomes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function getReview(
  ctx: UserContext,
  userId: string,
  planId: string,
  date: string,
): Promise<StoredReview | null> {
  const { rows } = await ctx.client.query<ReviewRow>(
    `select ${REVIEW_COLUMNS} from ${ctx.schema}.day_reviews
     where user_id = $1 and plan_id = $2 and date = $3`,
    [userId, planId, date],
  );
  return rows[0] ? toReview(rows[0]) : null;
}

/** Reviews on or after `from`, oldest first (the engine looks back only a few weeks). */
export async function listReviewsSince(
  ctx: UserContext,
  userId: string,
  planId: string,
  from: string,
): Promise<StoredReview[]> {
  const { rows } = await ctx.client.query<ReviewRow>(
    `select ${REVIEW_COLUMNS} from ${ctx.schema}.day_reviews
     where user_id = $1 and plan_id = $2 and date >= $3 order by date`,
    [userId, planId, from],
  );
  return rows.map(toReview);
}

/** The most recent `limit` ratings inside the optional range, oldest first. */
export async function listRatings(
  ctx: UserContext,
  userId: string,
  planId: string,
  from: string | undefined,
  to: string | undefined,
  limit: number,
): Promise<{ date: string; difficulty: number; density: number; energy: number }[]> {
  const { rows } = await ctx.client.query<{
    date: string;
    difficulty: number;
    density: number;
    energy: number;
  }>(
    `select date, difficulty, density, energy from (
       select date, difficulty, density, energy from ${ctx.schema}.day_reviews
       where user_id = $1 and plan_id = $2
         and ($3::date is null or date >= $3::date)
         and ($4::date is null or date <= $4::date)
       order by date desc limit $5
     ) latest order by date`,
    [userId, planId, from ?? null, to ?? null, limit],
  );
  return rows;
}

export interface ReviewFields {
  difficulty: number;
  density: number;
  energy: number;
  note: string;
  outcomes: TaskOutcome[];
}

export async function insertReview(
  ctx: UserContext,
  userId: string,
  planId: string,
  date: string,
  r: ReviewFields,
): Promise<boolean> {
  const { rowCount } = await ctx.client.query(
    `insert into ${ctx.schema}.day_reviews
       (user_id, plan_id, date, difficulty, density, energy, note, outcomes)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (user_id, plan_id, date) do nothing`,
    [userId, planId, date, r.difficulty, r.density, r.energy, r.note, JSON.stringify(r.outcomes)],
  );
  return rowCount === 1;
}

export async function updateReview(
  ctx: UserContext,
  userId: string,
  planId: string,
  date: string,
  r: ReviewFields,
): Promise<void> {
  await ctx.client.query(
    `update ${ctx.schema}.day_reviews set difficulty = $4, density = $5, energy = $6,
       note = $7, outcomes = $8, updated_at = now()
     where user_id = $1 and plan_id = $2 and date = $3`,
    [userId, planId, date, r.difficulty, r.density, r.energy, r.note, JSON.stringify(r.outcomes)],
  );
}

export interface StoredAdjustment {
  suggestionId: string;
  rule: AdjustmentRule;
  key: string;
  evidence: SuggestionEvidence;
  status: 'accepted' | 'rejected';
  option: number | null;
  appliedChange: ProposedChange | null;
  summary: ChangeSummary | null;
  decidedAt: Date;
}

interface AdjustmentRow {
  suggestion_id: string;
  rule: AdjustmentRule;
  key: string;
  evidence: SuggestionEvidence;
  status: 'accepted' | 'rejected';
  option_index: number | null;
  applied_change: ProposedChange | null;
  summary: ChangeSummary | null;
  decided_at: Date;
}

const toAdjustment = (r: AdjustmentRow): StoredAdjustment => ({
  suggestionId: r.suggestion_id,
  rule: r.rule,
  key: r.key,
  evidence: r.evidence,
  status: r.status,
  option: r.option_index,
  appliedChange: r.applied_change,
  summary: r.summary,
  decidedAt: r.decided_at,
});

const ADJUSTMENT_COLUMNS =
  'suggestion_id, rule, key, evidence, status, option_index, applied_change, summary, decided_at';

export async function listAdjustments(
  ctx: UserContext,
  userId: string,
  planId: string,
): Promise<StoredAdjustment[]> {
  const { rows } = await ctx.client.query<AdjustmentRow>(
    `select ${ADJUSTMENT_COLUMNS} from ${ctx.schema}.adjustments
     where user_id = $1 and plan_id = $2 order by decided_at, suggestion_id`,
    [userId, planId],
  );
  return rows.map(toAdjustment);
}

/** What the engine needs to know about earlier decisions. */
export const toDecided = (a: StoredAdjustment): DecidedSuggestion => ({
  rule: a.rule,
  key: a.key,
  decision: a.status,
  evidence: a.evidence,
});

export async function insertAdjustment(
  ctx: UserContext,
  userId: string,
  planId: string,
  a: Omit<StoredAdjustment, 'decidedAt'>,
): Promise<StoredAdjustment | null> {
  const { rows } = await ctx.client.query<AdjustmentRow>(
    `insert into ${ctx.schema}.adjustments
       (user_id, plan_id, suggestion_id, rule, key, evidence, status, option_index,
        applied_change, summary)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (user_id, plan_id, suggestion_id) do nothing
     returning ${ADJUSTMENT_COLUMNS}`,
    [
      userId,
      planId,
      a.suggestionId,
      a.rule,
      a.key,
      JSON.stringify(a.evidence),
      a.status,
      a.option,
      a.appliedChange === null ? null : JSON.stringify(a.appliedChange),
      a.summary === null ? null : JSON.stringify(a.summary),
    ],
  );
  return rows[0] ? toAdjustment(rows[0]) : null;
}
