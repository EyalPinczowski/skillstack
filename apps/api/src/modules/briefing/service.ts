import { buildBriefing, type Briefing } from '@skillstack/shared';
import type { SchedulingService } from '../scheduling/service';

/**
 * The day briefing (spec 3.2). Template-only in v0.2: the overview is always built by the
 * shared, deterministic `buildBriefing`; no AI provider is consulted, nothing is cached and
 * nothing is written. The day's blocks and warnings come from the scheduling service, which
 * rolls missed days over first, like every other read.
 */
export function createBriefingService(scheduling: SchedulingService) {
  return {
    async get(userId: string, planId: string, date: string): Promise<Briefing> {
      const day = await scheduling.dayPlan(userId, planId, date);
      return buildBriefing({
        date: day.date,
        blocks: day.blocks,
        tasks: day.tasks,
        earlierBlocks: day.earlierBlocks,
        pattern: day.pattern,
        overrides: day.overrides,
        warnings: day.warnings,
        finishDate: day.finishDate,
      });
    },
  };
}

export type BriefingService = ReturnType<typeof createBriefingService>;
