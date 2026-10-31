import {
  addDays,
  compareDates,
  diffDays,
  localDateOf,
  schedule,
  type Block,
  type Task,
  type WeekPattern,
} from '@skillstack/shared';
import type { Database, UserContext } from '../../db/database';
import { HttpError } from '../../errors';
import type { PlanDetail } from '../plans/schemas';
import * as plansRepo from '../plans/repository';
import * as repo from './repository';
import type { Snapshot } from './repository';

/** Never freeze more than this many missed days in one read (a plan older than that is not replayed). */
const MAX_ROLLOVER_DAYS = 400;

export type DayStatus = 'not_started' | 'started' | 'ended';

export interface DayState {
  date: string;
  status: DayStatus;
  startedAt: string | null;
  endedAt: string | null;
  /** The blocks that were planned for the date, once it is frozen; null before that. */
  frozen: { frozenAt: string; source: repo.SnapshotSource; blocks: Block[] } | null;
}

/** What a read needs: the plan, its pattern, the plan-local date and the stored past days. */
export interface DayContext {
  plan: PlanDetail;
  pattern: WeekPattern;
  /** Today's date in the plan's time zone. */
  today: string;
  /** The first date the app considers part of the plan (see `firstPlanDay`). */
  firstDay: string;
  snapshots: Snapshot[];
}

const unprocessable = (message: string) => new HttpError(422, 'unprocessable', message);

/**
 * The first date that belongs to the plan: its start date, but never before the day it was
 * created in the plan's zone. Importing a plan whose start date is long past must not replay
 * months of days nobody studied.
 */
export function firstPlanDay(plan: PlanDetail, timezone: string): string {
  const createdDay = localDateOf(new Date(plan.createdAt), timezone);
  return compareDates(plan.startDate, createdDay) >= 0 ? plan.startDate : createdDay;
}

/**
 * The tasks as they stood at the start of `date`: work logged on or after that date does not
 * count yet, and a task finished on or after it is open again. This is what was planned for the
 * day, not what is left after the day's own work.
 */
function tasksAtStartOf(
  tasks: Task[],
  logs: { taskId: string; date: string; hours: number }[],
  date: string,
): Task[] {
  const later = new Map<string, number>();
  for (const l of logs) {
    if (compareDates(l.date, date) >= 0) later.set(l.taskId, (later.get(l.taskId) ?? 0) + l.hours);
  }
  return tasks.map((t) => {
    const hours = later.get(t.id);
    if (!hours || t.status === 'skipped') return t;
    const doneHours = Math.max(0, t.doneHours - hours);
    return { ...t, doneHours, status: doneHours > 0 ? 'in_progress' : 'pending' };
  });
}

/** Day state and the stored past days. Plans are read through the plans repository (same transaction). */
export function createDaysService(db: Database, now: () => Date = () => new Date()) {
  async function load(ctx: UserContext, userId: string, planId: string) {
    const plan = await plansRepo.loadPlan(ctx, userId, planId);
    if (!plan) throw new HttpError(404, 'not_found', 'Resource not found.');
    if (!plan.weekPattern) throw unprocessable('The plan has no week pattern yet.');
    const pattern = plan.weekPattern;
    return {
      plan,
      pattern,
      today: localDateOf(now(), pattern.timezone),
      firstDay: firstPlanDay(plan, pattern.timezone),
    };
  }

  /** The blocks planned for `date`, from the plan as it stood at the start of that day. */
  function plannedFor(
    plan: PlanDetail,
    pattern: WeekPattern,
    date: string,
    snapshots: Snapshot[],
    logs: { taskId: string; date: string; hours: number }[],
  ): Block[] {
    const result = schedule({
      tasks: tasksAtStartOf(plan.tasks, logs, date),
      pattern,
      overrides: plan.overrides,
      today: date,
      frozenBlocks: snapshots.flatMap((s) => s.blocks),
    });
    return result.blocks.filter((b) => b.date === date);
  }

  /**
   * Freezes every missed past day (from the plan's first day up to yesterday) that has no
   * snapshot yet, oldest first, each one planned with the earlier days already frozen. Runs
   * inside the caller's transaction. A per-plan lock plus ON CONFLICT DO NOTHING make
   * simultaneous reads freeze each day once and write its event once.
   */
  async function rollover(
    ctx: UserContext,
    userId: string,
    c: Omit<DayContext, 'snapshots'>,
  ): Promise<Snapshot[]> {
    const lastPast = addDays(c.today, -1);
    const from =
      diffDays(c.firstDay, lastPast) >= MAX_ROLLOVER_DAYS
        ? addDays(lastPast, 1 - MAX_ROLLOVER_DAYS)
        : c.firstDay;
    const missing = (have: Snapshot[]): string[] => {
      const known = new Set(have.map((s) => s.date));
      const dates: string[] = [];
      for (let d = from; compareDates(d, lastPast) <= 0; d = addDays(d, 1)) {
        if (!known.has(d)) dates.push(d);
      }
      return dates;
    };

    let snapshots = await repo.listSnapshots(ctx, userId, c.plan.id);
    if (missing(snapshots).length === 0) return snapshots;

    await repo.lockPlanDays(ctx, userId, c.plan.id);
    // The request that held the lock may have frozen them already.
    snapshots = await repo.listSnapshots(ctx, userId, c.plan.id);
    const todo = missing(snapshots);
    if (todo.length === 0) return snapshots;

    const logs = await repo.logsFrom(ctx, userId, c.plan.id, todo[0]!);
    for (const date of todo) {
      const blocks = plannedFor(c.plan, c.pattern, date, snapshots, logs);
      if (await repo.insertSnapshot(ctx, userId, c.plan.id, date, blocks, 'auto_rollover')) {
        await plansRepo.insertEvent(ctx, userId, c.plan.id, 'day.rolled_over', {
          date,
          blockCount: blocks.length,
        });
      }
      snapshots = await repo.listSnapshots(ctx, userId, c.plan.id);
    }
    return snapshots;
  }

  async function dayState(
    ctx: UserContext,
    userId: string,
    planId: string,
    date: string,
  ): Promise<DayState> {
    // One after the other: a pg client runs a single query at a time.
    const session = await repo.getSession(ctx, userId, planId, date);
    const snapshots = await repo.listSnapshots(ctx, userId, planId);
    const snap = snapshots.find((s) => s.date === date);
    return {
      date,
      status: session?.endedAt ? 'ended' : session ? 'started' : 'not_started',
      startedAt: session?.startedAt.toISOString() ?? null,
      endedAt: session?.endedAt?.toISOString() ?? null,
      frozen: snap
        ? { frozenAt: snap.frozenAt.toISOString(), source: snap.source, blocks: snap.blocks }
        : null,
    };
  }

  /** A date the day actions accept: inside the plan and not after today (plan-local). */
  function requireActionable(c: { today: string; firstDay: string }, date: string, verb: string) {
    if (compareDates(date, c.today) > 0) throw unprocessable(`A future day cannot be ${verb}.`);
    if (compareDates(date, c.firstDay) < 0) {
      throw unprocessable(`A day before the plan began cannot be ${verb}.`);
    }
  }

  /**
   * Loads the plan and brings its stored past days up to date, inside the caller's transaction.
   * Every read that shows schedule or progress goes through here ("automatically on the first
   * visit the next day", spec 3.4).
   */
  async function open(ctx: UserContext, userId: string, planId: string): Promise<DayContext> {
    const c = await load(ctx, userId, planId);
    return { ...c, snapshots: await rollover(ctx, userId, c) };
  }

  return {
    open,

    /** The same for a read that has no use for the schedule: nothing happens without a week pattern. */
    rolloverIfScheduled(userId: string, planId: string): Promise<void> {
      return db.withUser(userId, async (ctx) => {
        const plan = await plansRepo.loadPlan(ctx, userId, planId);
        // A missing plan is left to the caller to report.
        if (!plan?.weekPattern) return;
        const tz = plan.weekPattern.timezone;
        await rollover(ctx, userId, {
          plan,
          pattern: plan.weekPattern,
          today: localDateOf(now(), tz),
          firstDay: firstPlanDay(plan, tz),
        });
      });
    },

    /** Idempotent. `created` is false when the day had been started before. */
    start: (userId: string, planId: string, date: string) =>
      db.withUser(userId, async (ctx) => {
        const c = await load(ctx, userId, planId);
        requireActionable(c, date, 'started');
        const created = await repo.insertSession(ctx, userId, planId, date);
        if (created) await plansRepo.insertEvent(ctx, userId, planId, 'day.started', { date });
        return { created, day: await dayState(ctx, userId, planId, date) };
      }),

    /**
     * Idempotent. Freezes the date's blocks (as planned at the start of that day) unless the day
     * is already frozen, marks the day ended and writes `day.ended` once.
     */
    end: (userId: string, planId: string, date: string) =>
      db.withUser(userId, async (ctx) => {
        const c = await load(ctx, userId, planId);
        requireActionable(c, date, 'ended');
        // Earlier days first, so the day being ended is planned with them frozen. The lock also
        // serialises two simultaneous End requests: the second finds everything done.
        await repo.lockPlanDays(ctx, userId, planId);
        const snapshots = await rollover(ctx, userId, c);
        let source: repo.SnapshotSource = 'day_end';
        const existing = snapshots.find((s) => s.date === date);
        if (existing) {
          source = existing.source;
        } else {
          const logs = await repo.logsFrom(ctx, userId, planId, date);
          const blocks = plannedFor(c.plan, c.pattern, date, snapshots, logs);
          await repo.insertSnapshot(ctx, userId, planId, date, blocks, 'day_end');
        }
        if (await repo.endSession(ctx, userId, planId, date)) {
          await plansRepo.insertEvent(ctx, userId, planId, 'day.ended', { date, source });
        }
        return dayState(ctx, userId, planId, date);
      }),

    /** Session state, plus the frozen blocks once the date is frozen. A past date is frozen first. */
    get: (userId: string, planId: string, date: string) =>
      db.withUser(userId, async (ctx) => {
        await open(ctx, userId, planId);
        return dayState(ctx, userId, planId, date);
      }),
  };
}

export type DaysService = ReturnType<typeof createDaysService>;
