import {
  addDays,
  compareDates,
  schedule,
  summarizeChanges,
  weekday,
  type AdjustableInputs,
  type ChangeSummary,
  type DayOverride,
  type ScheduleResult,
  type Task,
  type WeekPattern,
} from '@skillstack/shared';
import type { Database } from '../../db/database';
import type { DayContext, DaysService } from '../days/service';
import type { PlanDetail } from '../plans/schemas';

export interface ScheduleView {
  today: string;
  timezone: string;
  finishDate: string | null;
  blocks: ScheduleResult['blocks'];
  warnings: ScheduleResult['warnings'];
}

export interface PreviewChanges {
  today?: string;
  pattern?: WeekPattern;
  /** Added to the plan's overrides; an entry for an existing date replaces it. */
  overrides?: DayOverride[];
  /** Dates whose override would be removed. */
  removeOverrideDates?: string[];
}

export interface PreviewView {
  today: string;
  summary: ChangeSummary;
  current: Pick<ScheduleView, 'finishDate' | 'warnings'>;
  proposed: Pick<ScheduleView, 'finishDate' | 'warnings' | 'blocks'>;
}

export interface OpenTask {
  taskId: string;
  title: string;
  type: Task['type'];
  status: 'pending' | 'in_progress';
  estHours: number;
  doneHours: number;
  remainingHours: number;
  /** Dates of this week on which the task has blocks (frozen or still to come), ascending. */
  plannedDates: string[];
  /** Earlier frozen days on which the task was planned and is still not done, ascending. */
  carriedOverFrom: string[];
}

export interface OpenTasksView {
  today: string;
  /** The week is Sunday to Saturday in the plan's time zone and holds `today`. */
  weekStart: string;
  weekEnd: string;
  tasks: OpenTask[];
}

/**
 * The read side of scheduling: loads a plan, brings its stored past days up to date and hands
 * both to the pure engine in @skillstack/shared. No scheduling rule lives here. The only write
 * is the automatic freezing of days that have passed (see the days service).
 */
export function createSchedulingService(db: Database, days: DaysService) {
  /**
   * The first date the engine may change. Nothing is scheduled before the plan starts, and a
   * frozen day (ended, or rolled over) is never scheduled again: the schedule continues on the
   * first date from `viewDay` that is not frozen.
   */
  const engineToday = (c: DayContext, viewDay: string): string => {
    const frozen = new Set(c.snapshots.map((s) => s.date));
    let day = compareDates(viewDay, c.plan.startDate) < 0 ? c.plan.startDate : viewDay;
    while (frozen.has(day)) day = addDays(day, 1);
    return day;
  };

  const run = (
    c: DayContext,
    pattern: WeekPattern,
    overrides: DayOverride[],
    viewDay: string,
    tasks: Task[] = c.plan.tasks,
  ) =>
    schedule({
      tasks,
      pattern,
      overrides,
      today: engineToday(c, viewDay),
      frozenBlocks: c.snapshots.flatMap((s) => s.blocks),
    });

  const mergeOverrides = (plan: PlanDetail, changes: PreviewChanges): DayOverride[] => {
    const removed = new Set(changes.removeOverrideDates ?? []);
    const replaced = new Map((changes.overrides ?? []).map((o) => [o.date, o]));
    return [
      ...plan.overrides.filter((o) => !removed.has(o.date) && !replaced.has(o.date)),
      ...replaced.values(),
    ].sort((a, b) => compareDates(a.date, b.date));
  };

  /**
   * Pure: schedules the plan as it is and with the proposed inputs (same frozen days, same
   * first date the engine may change) and compares them. Nothing is read or saved here.
   */
  const compareProposal = (c: DayContext, proposed: AdjustableInputs): PreviewView => {
    const before = run(c, c.pattern, c.plan.overrides, c.today);
    const after = run(c, proposed.pattern, proposed.overrides, c.today, proposed.tasks);
    return {
      today: c.today,
      summary: summarizeChanges(before, after, {
        today: engineToday(c, c.today),
        pattern: proposed.pattern,
        overrides: proposed.overrides,
        tasks: proposed.tasks,
      }),
      current: { finishDate: before.finishDate, warnings: before.warnings },
      proposed: { finishDate: after.finishDate, warnings: after.warnings, blocks: after.blocks },
    };
  };

  return {
    compareProposal,

    async getSchedule(userId: string, planId: string, today?: string): Promise<ScheduleView> {
      return db.withUser(userId, async (ctx) => {
        const c = await days.open(ctx, userId, planId);
        const day = today ?? c.today;
        const result = run(c, c.pattern, c.plan.overrides, day);
        return {
          today: day,
          timezone: c.pattern.timezone,
          finishDate: result.finishDate,
          blocks: result.blocks,
          warnings: result.warnings,
        };
      });
    },

    /** Computes the schedule the changes would give and compares it; saves nothing but frozen past days. */
    async preview(userId: string, planId: string, changes: PreviewChanges): Promise<PreviewView> {
      return db.withUser(userId, async (ctx) => {
        const c = await days.open(ctx, userId, planId);
        const pattern = changes.pattern ?? c.pattern;
        const day = changes.today ?? c.today;
        const overrides = mergeOverrides(c.plan, changes);

        const before = run(c, c.pattern, c.plan.overrides, day);
        const after = run(c, pattern, overrides, day);
        return {
          today: day,
          summary: summarizeChanges(before, after, {
            today: engineToday(c, day),
            pattern,
            overrides,
            tasks: c.plan.tasks,
          }),
          current: { finishDate: before.finishDate, warnings: before.warnings },
          proposed: {
            finishDate: after.finishDate,
            warnings: after.warnings,
            blocks: after.blocks,
          },
        };
      });
    },

    /**
     * Tasks to show as "open" in the weekly view: not done and not skipped, and either planned
     * this week (a frozen day of the week or a block still to come) or carried over, meaning
     * planned on an earlier frozen day and still open.
     */
    async openTasks(userId: string, planId: string, today?: string): Promise<OpenTasksView> {
      return db.withUser(userId, async (ctx) => {
        const c = await days.open(ctx, userId, planId);
        const day = today ?? c.today;
        const weekStart = addDays(day, -weekday(day));
        const weekEnd = addDays(weekStart, 6);
        const result = run(c, c.pattern, c.plan.overrides, day);

        const carried = new Map<string, Set<string>>();
        for (const s of c.snapshots) {
          if (compareDates(s.date, day) > 0) continue;
          for (const b of s.blocks) {
            const dates = carried.get(b.taskId) ?? new Set<string>();
            dates.add(s.date);
            carried.set(b.taskId, dates);
          }
        }
        const planned = new Map<string, Set<string>>();
        for (const b of result.blocks) {
          if (compareDates(b.date, weekStart) < 0 || compareDates(b.date, weekEnd) > 0) continue;
          const dates = planned.get(b.taskId) ?? new Set<string>();
          dates.add(b.date);
          planned.set(b.taskId, dates);
        }

        const sorted = (set: Set<string> | undefined) => [...(set ?? [])].sort(compareDates);
        const tasks: OpenTask[] = [];
        for (const t of c.plan.tasks) {
          if (t.status !== 'pending' && t.status !== 'in_progress') continue;
          const plannedDates = sorted(planned.get(t.id));
          const carriedOverFrom = sorted(carried.get(t.id));
          if (plannedDates.length === 0 && carriedOverFrom.length === 0) continue;
          tasks.push({
            taskId: t.id,
            title: t.title,
            type: t.type,
            status: t.status,
            estHours: t.estHours,
            doneHours: t.doneHours,
            remainingHours: Math.max(0, t.estHours - t.doneHours),
            plannedDates,
            carriedOverFrom,
          });
        }
        return { today: day, weekStart, weekEnd, tasks };
      });
    },
  };
}

export type SchedulingService = ReturnType<typeof createSchedulingService>;
