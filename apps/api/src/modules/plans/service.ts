import type { DayOverride, WeekPattern } from '@skillstack/shared';
import type { Database } from '../../db/database';
import { HttpError } from '../../errors';
import { summarize, type ValidImport } from './import';
import * as repo from './repository';
import { MAX_OVERRIDES_PER_PLAN, type PlanDetail, type PlanSummary } from './schemas';

const notFound = () => new HttpError(404, 'not_found', 'Resource not found.');
const UNIQUE_VIOLATION = '23505';

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === UNIQUE_VIOLATION;

export interface ImportResult {
  /** False when the same plan had already been imported (an idempotent retry). */
  created: boolean;
  plan: PlanDetail;
}

/**
 * Plan operations. Every query runs inside db.withUser, so row-level security applies, and a
 * plan that is not the caller's looks exactly like one that does not exist.
 */
export function createPlanService(db: Database) {
  async function importOnce(userId: string, planId: string, input: ValidImport) {
    return db.withUser(userId, async (ctx): Promise<ImportResult> => {
      const existing = await repo.planExists(ctx, userId, planId);
      if (existing) {
        if ((await repo.importHashOf(ctx, userId, planId)) !== input.payloadHash) {
          throw new HttpError(
            409,
            'conflict',
            'A plan with this id already exists with different content.',
          );
        }
        return { created: false, plan: (await repo.loadPlan(ctx, userId, planId))! };
      }
      const { plan } = input;
      await repo.insertPlan(ctx, userId, planId, input.status, plan, summarize(plan));
      await repo.upsertWeekPattern(ctx, userId, planId, plan.weekPattern);
      await repo.insertOverrides(ctx, userId, planId, plan.overrides);
      await repo.insertTasks(ctx, userId, planId, plan.tasks);
      await repo.insertEvent(ctx, userId, planId, 'plan.imported', {
        payloadHash: input.payloadHash,
        taskCount: plan.tasks.length,
        overrideCount: plan.overrides.length,
        status: input.status,
      });
      return { created: true, plan: (await repo.loadPlan(ctx, userId, planId))! };
    });
  }

  return {
    /**
     * One transaction: plan, week pattern, overrides, tasks and the `plan.imported` event, or
     * nothing. Idempotent on the client's plan id: the same content returns the stored plan, other
     * content answers 409. Two simultaneous first calls collide on the primary key; the loser
     * runs once more and then takes the "already imported" path.
     */
    async importPlan(userId: string, planId: string, input: ValidImport): Promise<ImportResult> {
      try {
        return await importOnce(userId, planId, input);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        return importOnce(userId, planId, input);
      }
    },

    list: (userId: string): Promise<PlanSummary[]> =>
      db.withUser(userId, (ctx) => repo.listPlans(ctx, userId)),

    async get(userId: string, planId: string): Promise<PlanDetail> {
      const plan = await db.withUser(userId, (ctx) => repo.loadPlan(ctx, userId, planId));
      if (!plan) throw notFound();
      return plan;
    },

    async remove(userId: string, planId: string): Promise<void> {
      const removed = await db.withUser(userId, (ctx) => repo.deletePlan(ctx, userId, planId));
      if (!removed) throw notFound();
    },

    putWeekPattern: (userId: string, planId: string, pattern: WeekPattern) =>
      db.withUser(userId, async (ctx) => {
        if (!(await repo.planExists(ctx, userId, planId))) throw notFound();
        await repo.upsertWeekPattern(ctx, userId, planId, pattern);
        await repo.touchPlan(ctx, userId, planId);
        return (await repo.loadPlan(ctx, userId, planId))!.weekPattern!;
      }),

    putDayOverride: (userId: string, planId: string, override: DayOverride) =>
      db.withUser(userId, async (ctx) => {
        if (!(await repo.planExists(ctx, userId, planId))) throw notFound();
        const known = await repo.dayOverrideExists(ctx, userId, planId, override.date);
        if (
          !known &&
          (await repo.countDayOverrides(ctx, userId, planId)) >= MAX_OVERRIDES_PER_PLAN
        ) {
          throw new HttpError(
            422,
            'unprocessable',
            `A plan can have at most ${MAX_OVERRIDES_PER_PLAN} day overrides.`,
          );
        }
        await repo.upsertDayOverride(ctx, userId, planId, override);
        await repo.touchPlan(ctx, userId, planId);
        return override;
      }),

    /** Idempotent: removing an override that is not there succeeds. The plan itself must exist. */
    removeDayOverride: (userId: string, planId: string, date: string) =>
      db.withUser(userId, async (ctx) => {
        if (!(await repo.planExists(ctx, userId, planId))) throw notFound();
        await repo.deleteDayOverride(ctx, userId, planId, date);
        await repo.touchPlan(ctx, userId, planId);
      }),
  };
}

export type PlanService = ReturnType<typeof createPlanService>;
