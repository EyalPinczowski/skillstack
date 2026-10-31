import type { Block } from '@skillstack/shared';
import { advisoryKey, type UserContext } from '../../db/database';

export type SnapshotSource = 'day_end' | 'auto_rollover';

export interface Snapshot {
  date: string;
  blocks: Block[];
  frozenAt: Date;
  source: SnapshotSource;
}

export interface Session {
  date: string;
  startedAt: Date;
  endedAt: Date | null;
}

interface SnapshotRow {
  date: string;
  blocks: Block[];
  frozen_at: Date;
  source: SnapshotSource;
}

interface SessionRow {
  date: string;
  started_at: Date;
  ended_at: Date | null;
}

const toSnapshot = (r: SnapshotRow): Snapshot => ({
  date: r.date,
  blocks: r.blocks,
  frozenAt: r.frozen_at,
  source: r.source,
});
const toSession = (r: SessionRow): Session => ({
  date: r.date,
  startedAt: r.started_at,
  endedAt: r.ended_at,
});

/**
 * Serialises the writers of one plan's day state for the rest of the transaction, so two
 * simultaneous reads that both find a day unfrozen freeze it once. The key is a hash of ids the
 * server already verified; the lock is released at commit or rollback.
 */
export async function lockPlanDays(
  ctx: UserContext,
  userId: string,
  planId: string,
): Promise<void> {
  // The same user and client plan id can exist in both environments (one Supabase Auth, ADR 003),
  // which is why advisoryKey puts the schema into the key.
  await ctx.client.query(`select pg_advisory_xact_lock(hashtextextended($1::text, 0))`, [
    advisoryKey(ctx, 'days', userId, planId),
  ]);
}

export async function listSnapshots(
  ctx: UserContext,
  userId: string,
  planId: string,
): Promise<Snapshot[]> {
  const { rows } = await ctx.client.query<SnapshotRow>(
    `select date, blocks, frozen_at, source from ${ctx.schema}.schedule_days
     where user_id = $1 and plan_id = $2 order by date`,
    [userId, planId],
  );
  return rows.map(toSnapshot);
}

/** True when this call stored the snapshot; false when one already existed (it is never replaced). */
export async function insertSnapshot(
  ctx: UserContext,
  userId: string,
  planId: string,
  date: string,
  blocks: Block[],
  source: SnapshotSource,
): Promise<boolean> {
  const { rowCount } = await ctx.client.query(
    `insert into ${ctx.schema}.schedule_days (user_id, plan_id, date, blocks, source)
     values ($1, $2, $3, $4, $5)
     on conflict (user_id, plan_id, date) do nothing`,
    [userId, planId, date, JSON.stringify(blocks), source],
  );
  return rowCount === 1;
}

export async function getSession(
  ctx: UserContext,
  userId: string,
  planId: string,
  date: string,
): Promise<Session | null> {
  const { rows } = await ctx.client.query<SessionRow>(
    `select date, started_at, ended_at from ${ctx.schema}.day_sessions
     where user_id = $1 and plan_id = $2 and date = $3`,
    [userId, planId, date],
  );
  return rows[0] ? toSession(rows[0]) : null;
}

/** False when the day was already started (the row is left as it is). */
export async function insertSession(
  ctx: UserContext,
  userId: string,
  planId: string,
  date: string,
): Promise<boolean> {
  const { rowCount } = await ctx.client.query(
    `insert into ${ctx.schema}.day_sessions (user_id, plan_id, date)
     values ($1, $2, $3) on conflict (user_id, plan_id, date) do nothing`,
    [userId, planId, date],
  );
  return rowCount === 1;
}

/**
 * Sets ended_at once. A day that was never started gets a session that starts and ends now.
 * False when the day had already ended: nothing changes.
 */
export async function endSession(
  ctx: UserContext,
  userId: string,
  planId: string,
  date: string,
): Promise<boolean> {
  const { rowCount } = await ctx.client.query(
    `insert into ${ctx.schema}.day_sessions as s (user_id, plan_id, date, started_at, ended_at)
     values ($1, $2, $3, now(), now())
     on conflict (user_id, plan_id, date) do update set ended_at = now()
       where s.ended_at is null`,
    [userId, planId, date],
  );
  return rowCount === 1;
}

/**
 * For each task that is done or skipped now: the plan-local date of its latest `task.completed`
 * or `task.skipped` event. A task with no such event (changed before these events existed, or
 * created that way) is absent.
 */
export async function statusChangeDates(
  ctx: UserContext,
  userId: string,
  planId: string,
  timezone: string,
): Promise<Map<string, { status: 'done' | 'skipped'; date: string }>> {
  const { rows } = await ctx.client.query<{
    task_id: string;
    type: 'task.completed' | 'task.skipped';
    date: string;
  }>(
    `select distinct on (payload ->> 'taskId')
            payload ->> 'taskId' as task_id, type,
            coalesce(payload ->> 'date', (created_at at time zone $3)::date::text) as date
     from ${ctx.schema}.events
     where user_id = $1 and plan_id = $2 and type in ('task.completed', 'task.skipped')
     order by payload ->> 'taskId', created_at desc, id desc`,
    [userId, planId, timezone],
  );
  return new Map(
    rows.map((r) => [
      r.task_id,
      {
        status: r.type === 'task.completed' ? ('done' as const) : ('skipped' as const),
        date: r.date,
      },
    ]),
  );
}

/** Hours logged per task and date on or after `from`. */
export async function logsFrom(
  ctx: UserContext,
  userId: string,
  planId: string,
  from: string,
): Promise<{ taskId: string; date: string; hours: number }[]> {
  const { rows } = await ctx.client.query<{ task_id: string; date: string; hours: number }>(
    `select task_id, date, sum(hours)::float8 as hours from ${ctx.schema}.logs
     where user_id = $1 and plan_id = $2 and date >= $3
     group by task_id, date`,
    [userId, planId, from],
  );
  return rows.map((r) => ({ taskId: r.task_id, date: r.date, hours: r.hours }));
}
