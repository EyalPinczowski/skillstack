import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import type { DayReview, Task } from '../schemas';
import {
  applySuggestion,
  MIN_COMPLETED_TASKS_FOR_ESTIMATES,
  suggestAdjustments,
  suggestionOptions,
  type AdjustmentInput,
  type LogEntry,
} from './adjustments';
import { basePattern, task } from './test-helpers';

const TODAY = '2026-11-05';

const scale = fc.integer({ min: 1, max: 5 });

const reviewsArb: fc.Arbitrary<DayReview[]> = fc
  .uniqueArray(fc.integer({ min: -12, max: 2 }), { maxLength: 10 })
  .chain((offsets) =>
    fc.tuple(
      ...offsets.map((o) =>
        fc.record({
          date: fc.constant(addDays(TODAY, o)),
          difficulty: scale,
          density: scale,
          energy: scale,
          note: fc.constant(''),
          outcomes: fc.uniqueArray(
            fc.record({
              taskId: fc.constantFrom('t0', 't1', 't2', 't3'),
              outcome: fc.constantFrom('done' as const, 'not_done' as const),
            }),
            { maxLength: 3, selector: (x) => x.taskId },
          ),
        }),
      ),
    ),
  );

const tasksArb: fc.Arbitrary<Task[]> = fc
  .array(
    fc.record({
      type: fc.constantFrom('course' as const, 'practice' as const, 'admin' as const),
      status: fc.constantFrom('pending' as const, 'in_progress' as const, 'done' as const),
      est: fc.constantFrom(1, 2, 4, 8),
      provider: fc.constantFrom('A', 'B', undefined),
    }),
    { maxLength: 8 },
  )
  .map((specs) =>
    specs.map((s, i) =>
      task({
        id: `t${i}`,
        order: i,
        type: s.type,
        status: s.status,
        estHours: s.est,
        ...(s.provider ? { provider: s.provider } : {}),
      }),
    ),
  );

const logsArb = (n: number): fc.Arbitrary<LogEntry[]> =>
  fc.array(
    fc.record({
      taskId: fc.integer({ min: 0, max: Math.max(0, n - 1) }).map((i) => `t${i}`),
      date: fc.integer({ min: -10, max: 1 }).map((o) => addDays(TODAY, o)),
      hours: fc.constantFrom(0.5, 1, 2, 5, 12),
    }),
    { maxLength: 12 },
  );

const inputArb: fc.Arbitrary<AdjustmentInput> = fc
  .tuple(reviewsArb, tasksArb)
  .chain(([reviews, tasks]) =>
    logsArb(tasks.length).map((logs) => ({
      reviews,
      tasks,
      logs,
      pattern: basePattern,
      today: TODAY,
    })),
  );

const clone = <T>(v: T): T => structuredClone(v);

describe('adjustments (property)', () => {
  it('is deterministic, never mutates its input and keeps ids unique', () => {
    fc.assert(
      fc.property(inputArb, (i) => {
        const snapshot = clone(i);
        const a = suggestAdjustments(i);
        expect(i).toEqual(snapshot);
        expect(suggestAdjustments(clone(i))).toEqual(a);
        expect(new Set(a.map((s) => s.id)).size).toBe(a.length);
      }),
    );
  });

  it('does not depend on the order of reviews, logs or tasks', () => {
    fc.assert(
      fc.property(inputArb, (i) => {
        const shuffled = {
          ...i,
          reviews: [...i.reviews].reverse(),
          logs: [...i.logs].reverse(),
          tasks: [...i.tasks].reverse(),
        };
        expect(suggestAdjustments(shuffled)).toEqual(suggestAdjustments(i));
      }),
    );
  });

  it('never suggests without enough evidence', () => {
    fc.assert(
      fc.property(inputArb, (i) => {
        for (const s of suggestAdjustments(i)) {
          if (s.rule === 'density_too_high') {
            expect(s.evidence.reviewDates).toHaveLength(2);
            const rs = i.reviews.filter((r) => s.evidence.reviewDates.includes(r.date));
            expect(rs).toHaveLength(2);
            expect(rs.every((r) => r.density >= 4)).toBe(true);
          }
          if (s.rule === 'density_too_low') {
            const r = i.reviews.find((x) => x.date === s.evidence.reviewDates[0]);
            expect(r?.density).toBeLessThanOrEqual(2);
          }
          if (s.rule === 'estimate_drift') {
            expect(s.evidence.taskIds.length).toBeGreaterThanOrEqual(
              MIN_COMPLETED_TASKS_FOR_ESTIMATES,
            );
            for (const id of s.evidence.taskIds) {
              expect(i.tasks.find((t) => t.id === id)?.status).toBe('done');
            }
          }
          if (s.rule === 'difficulty_practice') {
            const r = i.reviews.find((x) => x.date === s.evidence.reviewDates[0]);
            expect(r?.difficulty).toBeGreaterThanOrEqual(4);
          }
        }
      }),
    );
  });

  it('never re-offers a rejected suggestion', () => {
    fc.assert(
      fc.property(inputArb, (i) => {
        const decided = suggestAdjustments(i).map((s) => ({
          rule: s.rule,
          key: s.key,
          decision: 'rejected' as const,
        }));
        expect(suggestAdjustments({ ...i, decided })).toEqual([]);
      }),
    );
  });

  it('applySuggestion never mutates its inputs and returns valid values', () => {
    fc.assert(
      fc.property(inputArb, (i) => {
        for (const s of suggestAdjustments(i)) {
          for (let k = 0; k < suggestionOptions(s).length; k++) {
            const snapshot = clone({ tasks: i.tasks, pattern: i.pattern, s });
            const out = applySuggestion(i.tasks, i.pattern, [], s, k);
            expect(clone({ tasks: i.tasks, pattern: i.pattern, s })).toEqual(snapshot);
            for (const t of out.tasks) expect(t.estHours).toBeGreaterThan(0);
            for (const h of Object.values(out.pattern.hoursByWeekday)) {
              expect(h).toBeGreaterThanOrEqual(0);
              expect(h).toBeLessThanOrEqual(24);
            }
          }
        }
      }),
    );
  });
});
