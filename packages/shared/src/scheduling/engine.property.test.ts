import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, diffDays, formatTime, parseTime } from '../dates';
import {
  TaskSchema,
  WeekPatternSchema,
  type Block,
  type BusyInterval,
  type Task,
} from '../schemas';
import { dayCapacity, isStudyDay } from './capacity';
import { schedule } from './engine';

const TODAY = '2026-11-01';
const HOURS = [0.25, 0.5, 1, 1.5, 2, 3, 5, 8, 12];

const patternArb = fc
  .record({
    weekdays: fc.uniqueArray(fc.integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 7 }),
    defaultHours: fc.integer({ min: 1, max: 8 }),
    startHour: fc.integer({ min: 7, max: 10 }),
    endHour: fc.integer({ min: 15, max: 21 }),
    lunch: fc.boolean(),
    breakEveryHours: fc.integer({ min: 1, max: 3 }),
    breakMinutes: fc.constantFrom(0, 5, 10, 15),
    minBlockMinutes: fc.constantFrom(15, 30, 45, 60),
  })
  .map((p) =>
    WeekPatternSchema.parse({
      studyWeekdays: p.weekdays,
      defaultHours: p.defaultHours,
      windowStart: formatTime(p.startHour * 60),
      windowEnd: formatTime(p.endHour * 60),
      ...(p.lunch ? { lunchStart: '12:00', lunchEnd: '13:00' } : {}),
      breakEveryHours: p.breakEveryHours,
      breakMinutes: p.breakMinutes,
      minBlockMinutes: p.minBlockMinutes,
      timezone: 'UTC',
    }),
  );

const tasksArb = fc
  .array(
    fc.record({
      hours: fc.constantFrom(...HOURS),
      splittable: fc.boolean(),
      depPicks: fc.array(fc.nat(), { maxLength: 2 }),
      notBeforeOffset: fc.option(fc.integer({ min: 0, max: 6 }), { nil: undefined }),
    }),
    { minLength: 1, maxLength: 14 },
  )
  .map((raw) =>
    raw.map((r, i): Task => {
      const deps = i === 0 ? [] : [...new Set(r.depPicks.map((d) => `p${d % i}`))];
      return TaskSchema.parse({
        id: `p${i}`,
        title: `Task ${i}`,
        type: r.splittable ? 'course' : 'practice',
        estHours: r.hours,
        order: i,
        splittable: r.splittable,
        dependsOn: deps,
        ...(r.notBeforeOffset !== undefined
          ? { notBefore: addDays(TODAY, r.notBeforeOffset) }
          : {}),
      });
    }),
  );

const busyArb = fc
  .array(
    fc.record({
      day: fc.integer({ min: 0, max: 10 }),
      start: fc.integer({ min: 16, max: 34 }),
      halfHours: fc.integer({ min: 1, max: 6 }),
    }),
    { maxLength: 4 },
  )
  .map((list): BusyInterval[] =>
    list.map((b) => ({
      date: addDays(TODAY, b.day),
      start: formatTime(b.start * 30),
      end: formatTime(Math.min(b.start + b.halfHours, 47) * 30),
    })),
  );

const absStart = (b: Block) => diffDays(TODAY, b.date) * 1440 + parseTime(b.start);
const absEnd = (b: Block) => diffDays(TODAY, b.date) * 1440 + parseTime(b.end);

describe('scheduling engine invariants (property-based)', () => {
  it('always produces a valid schedule', () => {
    fc.assert(
      fc.property(patternArb, tasksArb, busyArb, (pattern, tasks, busy) => {
        const result = schedule({ tasks, pattern, today: TODAY, busy, horizonDays: 400 });
        const ws = parseTime(pattern.windowStart);
        const we = parseTime(pattern.windowEnd);
        const byTask = new Map<string, Block[]>();
        for (const b of result.blocks) byTask.set(b.taskId, [...(byTask.get(b.taskId) ?? []), b]);

        for (const b of result.blocks) {
          const s = parseTime(b.start);
          const e = parseTime(b.end);
          expect(e).toBeGreaterThan(s);
          // Inside the window, outside lunch and busy time, only on study days.
          expect(s).toBeGreaterThanOrEqual(ws);
          expect(e).toBeLessThanOrEqual(we);
          if (pattern.lunchStart && pattern.lunchEnd) {
            expect(e <= parseTime(pattern.lunchStart) || s >= parseTime(pattern.lunchEnd)).toBe(
              true,
            );
          }
          for (const x of busy.filter((x) => x.date === b.date)) {
            expect(e <= parseTime(x.start) || s >= parseTime(x.end)).toBe(true);
          }
          expect(isStudyDay(b.date, pattern, [])).toBe(true);
        }

        // No overlapping blocks, and no day above its capacity.
        const dates = new Set(result.blocks.map((b) => b.date));
        for (const date of dates) {
          const day = result.blocks
            .filter((b) => b.date === date)
            .sort((a, b) => a.start.localeCompare(b.start));
          for (let i = 1; i < day.length; i++) {
            expect(parseTime(day[i]!.start)).toBeGreaterThanOrEqual(parseTime(day[i - 1]!.end));
          }
          const used = day.reduce((s, b) => s + b.minutes, 0);
          expect(used).toBeLessThanOrEqual(dayCapacity(date, pattern, [], busy).capacityMinutes);
        }

        const unscheduled = new Set(
          result.warnings.flatMap((w) => (w.kind === 'unscheduled' ? [w.taskId] : [])),
        );
        for (const t of tasks) {
          const blocks = (byTask.get(t.id) ?? []).sort((a, b) => absStart(a) - absStart(b));
          const total = blocks.reduce((s, b) => s + b.minutes, 0);
          const need = Math.round(t.estHours * 60);
          // Never more than needed; exactly what's needed unless reported as unscheduled.
          expect(total).toBeLessThanOrEqual(need);
          if (!unscheduled.has(t.id)) expect(total).toBe(need);
          // Only the last piece of a task may be shorter than the minimum block.
          blocks
            .slice(0, -1)
            .forEach((b) => expect(b.minutes).toBeGreaterThanOrEqual(pattern.minBlockMinutes));
          if (!t.splittable) expect(blocks.length).toBeLessThanOrEqual(1);
          if (t.notBefore) blocks.forEach((b) => expect(b.date >= t.notBefore!).toBe(true));
          // A task starts only after each dependency has fully finished.
          for (const dep of t.dependsOn) {
            const depBlocks = byTask.get(dep) ?? [];
            if (blocks.length === 0) continue;
            expect(unscheduled.has(dep)).toBe(false);
            const depEnd = Math.max(...depBlocks.map(absEnd));
            expect(absStart(blocks[0]!)).toBeGreaterThanOrEqual(depEnd);
          }
        }

        // Deterministic: the same input gives the same output.
        expect(schedule({ tasks, pattern, today: TODAY, busy, horizonDays: 400 })).toEqual(result);
      }),
      { numRuns: 200 },
    );
  });

  it('never moves frozen past blocks', () => {
    fc.assert(
      fc.property(patternArb, tasksArb, (pattern, tasks) => {
        const first = schedule({ tasks, pattern, today: TODAY, horizonDays: 400 });
        const cut = addDays(TODAY, 3);
        const frozen = first.blocks.filter((b) => b.date < cut);
        const second = schedule({
          tasks,
          pattern,
          today: cut,
          frozenBlocks: frozen,
          horizonDays: 400,
        });
        expect(second.blocks.filter((b) => b.date < cut)).toEqual(frozen);
      }),
      { numRuns: 100 },
    );
  });
});

describe('performance (spec 1: a reschedule completes in under 2 seconds)', () => {
  it('schedules a 32-task, four-week plan well under 2 seconds', () => {
    const tasks: Task[] = Array.from({ length: 32 }, (_, i) =>
      TaskSchema.parse({
        id: `perf${i}`,
        title: `Task ${i}`,
        type: i % 4 === 3 ? 'practice' : 'course',
        estHours: HOURS[i % HOURS.length]!,
        order: i,
        splittable: i % 4 !== 3,
        dependsOn: i > 2 && i % 3 === 0 ? [`perf${i - 3}`] : [],
      }),
    );
    const pattern = WeekPatternSchema.parse({
      studyWeekdays: [0, 1, 2, 3, 4],
      defaultHours: 7,
      windowStart: '09:00',
      windowEnd: '17:30',
      lunchStart: '13:00',
      lunchEnd: '14:00',
      timezone: 'Asia/Jerusalem',
    });
    const started = performance.now();
    for (let i = 0; i < 20; i++) schedule({ tasks, pattern, today: TODAY });
    const perRun = (performance.now() - started) / 20;
    expect(perRun).toBeLessThan(2000);
  });
});
