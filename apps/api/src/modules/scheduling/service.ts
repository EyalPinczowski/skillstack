import {
  localDateOf,
  schedule,
  summarizeChanges,
  type ChangeSummary,
  type DayOverride,
  type ScheduleResult,
  type WeekPattern,
} from '@skillstack/shared';
import { HttpError } from '../../errors';
import type { PlanDetail } from '../plans/schemas';
import type { PlanService } from '../plans/service';

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

function requirePattern(plan: PlanDetail): WeekPattern {
  if (!plan.weekPattern) {
    throw new HttpError(422, 'unprocessable', 'The plan has no week pattern yet.');
  }
  return plan.weekPattern;
}

/**
 * The read side of scheduling: loads a plan through the plan service and hands it to the pure
 * engine in @skillstack/shared. No scheduling rule lives here, and nothing here writes.
 */
export function createSchedulingService(plans: PlanService) {
  const run = (plan: PlanDetail, pattern: WeekPattern, overrides: DayOverride[], today: string) =>
    schedule({ tasks: plan.tasks, pattern, overrides, today });

  return {
    async getSchedule(userId: string, planId: string, today?: string): Promise<ScheduleView> {
      const plan = await plans.get(userId, planId);
      const pattern = requirePattern(plan);
      const day = today ?? localDateOf(new Date(), pattern.timezone);
      const result = run(plan, pattern, plan.overrides, day);
      return {
        today: day,
        timezone: pattern.timezone,
        finishDate: result.finishDate,
        blocks: result.blocks,
        warnings: result.warnings,
      };
    },

    /** Computes the schedule the changes would give and compares it; saves nothing. */
    async preview(userId: string, planId: string, changes: PreviewChanges): Promise<PreviewView> {
      const plan = await plans.get(userId, planId);
      const current = requirePattern(plan);
      const pattern = changes.pattern ?? current;
      const day = changes.today ?? localDateOf(new Date(), current.timezone);

      const removed = new Set(changes.removeOverrideDates ?? []);
      const replaced = new Map((changes.overrides ?? []).map((o) => [o.date, o]));
      const overrides = [
        ...plan.overrides.filter((o) => !removed.has(o.date) && !replaced.has(o.date)),
        ...replaced.values(),
      ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

      const before = run(plan, current, plan.overrides, day);
      const after = run(plan, pattern, overrides, day);
      return {
        today: day,
        summary: summarizeChanges(before, after, {
          today: day,
          pattern,
          overrides,
          tasks: plan.tasks,
        }),
        current: { finishDate: before.finishDate, warnings: before.warnings },
        proposed: { finishDate: after.finishDate, warnings: after.warnings, blocks: after.blocks },
      };
    },
  };
}

export type SchedulingService = ReturnType<typeof createSchedulingService>;
