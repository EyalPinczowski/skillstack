import { describe, expect, it } from 'vitest';
import { WeekPatternSchema } from '../schemas';
import { dayCapacity } from './capacity';
import { summarizeChanges } from './changes';
import { createCvUpdateTask } from './cv';
import { schedule } from './engine';
import { basePattern, endOf, minutesOn, startOf, task } from './test-helpers';

// 1 November 2026 is a Sunday.
const SUN = '2026-11-01';
const MON = '2026-11-02';
const TUE = '2026-11-03';
const THU = '2026-11-05';

describe('scheduling (spec 9)', () => {
  it('splits a 10-hour task on a 7-hour day: 7 today, 3 tomorrow', () => {
    const t = task({ estHours: 10 });
    const result = schedule({ tasks: [t], pattern: basePattern, today: SUN });
    expect(minutesOn(result.blocks, SUN, t.id)).toBe(420);
    expect(minutesOn(result.blocks, MON, t.id)).toBe(180);
    expect(result.finishDate).toBe(MON);
  });

  it('carries over the rest of a partial task ("2 of 5") and shifts everything after it', () => {
    const a = task({ estHours: 5, order: 1 });
    const b = task({ estHours: 7, order: 2 });
    const before = schedule({ tasks: [a, b], pattern: basePattern, today: SUN });
    expect(minutesOn(before.blocks, SUN, a.id)).toBe(300);

    // The day ended with only 2 of A's 5 hours done; reschedule from Monday.
    const frozenBlocks = before.blocks.filter((x) => x.date === SUN);
    const after = schedule({
      tasks: [{ ...a, doneHours: 2 }, b],
      pattern: basePattern,
      today: MON,
      frozenBlocks,
    });
    expect(minutesOn(after.blocks, MON, a.id)).toBe(180);
    expect(after.blocks.filter((x) => x.date === SUN)).toEqual(frozenBlocks);
    const firstB = after.blocks.find((x) => x.taskId === b.id && x.date >= MON);
    const lastA = after.blocks.filter((x) => x.taskId === a.id && x.date === MON).at(-1);
    expect(firstB && lastA && startOf(firstB) >= endOf(lastA)).toBe(true);
    expect(after.finishDate).toBe(TUE);
  });

  it('moves tasks into an added Friday and brings the finish date forward', () => {
    const tasks = Array.from({ length: 6 }, (_, i) => task({ estHours: 7, order: i + 1 }));
    const before = schedule({ tasks, pattern: basePattern, today: SUN });
    const withFriday = { ...basePattern, studyWeekdays: [0, 1, 2, 3, 4, 5] };
    const after = schedule({ tasks, pattern: withFriday, today: SUN });
    expect(before.finishDate).toBe('2026-11-08');
    expect(after.finishDate).toBe('2026-11-06');
    expect(minutesOn(after.blocks, '2026-11-06')).toBe(420);

    const summary = summarizeChanges(before, after, { today: SUN, pattern: withFriday });
    expect(summary.finishShiftStudyDays).toBeLessThan(0);
    expect(summary.text).toMatch(/moved up/);
  });

  it('warns when an anchor exam is at risk, with the three options', () => {
    const prep = task({ estHours: 20, order: 1 });
    const exam = task({
      type: 'cert_exam',
      estHours: 1.5,
      order: 2,
      splittable: false,
      dependsOn: [prep.id],
      isAnchor: true,
      anchorDate: MON,
      anchorStartTime: '09:00',
    });
    const result = schedule({ tasks: [prep, exam], pattern: basePattern, today: SUN });
    const warning = result.warnings.find((w) => w.kind === 'anchor_at_risk');
    expect(warning).toBeDefined();
    if (warning?.kind !== 'anchor_at_risk') return;
    expect(warning.taskId).toBe(exam.id);
    expect(warning.shortfallMinutes).toBe(20 * 60 - 420);
    expect(warning.options.map((o) => o.kind)).toEqual(['add_hours', 'add_day', 'move_exam']);
    // The exam itself stays at its date and time.
    expect(result.blocks.find((b) => b.taskId === exam.id)).toMatchObject({
      date: MON,
      start: '09:00',
      end: '10:30',
      kind: 'anchor',
    });
  });

  it('creates a CV-update task on the same day a certificate is completed', () => {
    const cert = task({
      estHours: 2,
      order: 1,
      isCertificate: true,
      certificateName: 'Postman API Fundamentals',
    });
    const other = task({ estHours: 10, order: 2 });
    const done = { ...cert, status: 'done' as const, doneHours: 2 };
    const cv = createCvUpdateTask(done, TUE);
    expect(cv.title).toBe('Update CV and LinkedIn: Postman API Fundamentals');
    expect(cv.estHours).toBe(0.25);

    const result = schedule({
      tasks: [done, other, cv],
      pattern: basePattern,
      today: TUE,
      nowMinutes: 11 * 60,
    });
    expect(result.blocks.find((b) => b.taskId === cv.id)).toMatchObject({
      date: TUE,
      start: '11:00',
      end: '11:15',
    });
  });

  it('never changes past days', () => {
    const frozenBlocks = [
      {
        taskId: 'old',
        date: '2026-10-29',
        start: '09:00',
        end: '12:00',
        minutes: 180,
        kind: 'study' as const,
      },
    ];
    const result = schedule({
      tasks: [task({ estHours: 3 })],
      pattern: basePattern,
      today: SUN,
      frozenBlocks,
    });
    expect(result.blocks.filter((b) => b.date < SUN)).toEqual(frozenBlocks);
    expect(result.days[0]?.date).toBe('2026-10-29');
  });
});

describe('time settings (spec 9)', () => {
  it('gives every Thursday 5 hours with a per-weekday override', () => {
    const pattern = { ...basePattern, hoursByWeekday: { '4': 5 } };
    const result = schedule({ tasks: [task({ estHours: 80 })], pattern, today: SUN });
    expect(minutesOn(result.blocks, THU)).toBe(300);
    expect(minutesOn(result.blocks, '2026-11-12')).toBe(300);
    expect(minutesOn(result.blocks, '2026-11-04')).toBe(420);
  });

  it('leaves a 20-minute gap next to a 1-hour event empty (minimum block 30 minutes)', () => {
    const busy = [{ date: SUN, start: '09:20', end: '10:20' }];
    const result = schedule({
      tasks: [task({ estHours: 20 })],
      pattern: basePattern,
      today: SUN,
      busy,
    });
    const sunday = result.blocks.filter((b) => b.date === SUN);
    expect(sunday.every((b) => startOf(b) >= 10 * 60 + 20)).toBe(true);
    // Capacity is 7 h − 1 h = 360 min, but with the 10-minute breaks only 350 min fit after 10:20.
    expect(dayCapacity(SUN, basePattern, [], busy).capacityMinutes).toBe(360);
    expect(minutesOn(result.blocks, SUN)).toBe(350);
  });

  it('never schedules inside the lunch break or outside the daily window', () => {
    const result = schedule({ tasks: [task({ estHours: 40 })], pattern: basePattern, today: SUN });
    for (const b of result.blocks) {
      expect(startOf(b)).toBeGreaterThanOrEqual(9 * 60);
      expect(endOf(b)).toBeLessThanOrEqual(17 * 60 + 30);
      expect(endOf(b) <= 13 * 60 || startOf(b) >= 14 * 60).toBe(true);
    }
  });

  it('places an exam exactly at its start time and schedules other work around it', () => {
    const work = task({ estHours: 14, order: 1 });
    const exam = task({
      type: 'cert_exam',
      estHours: 1,
      order: 2,
      splittable: false,
      isAnchor: true,
      anchorDate: MON,
      anchorStartTime: '10:00',
    });
    const result = schedule({ tasks: [work, exam], pattern: basePattern, today: SUN });
    expect(result.blocks.find((b) => b.taskId === exam.id)).toMatchObject({
      date: MON,
      start: '10:00',
      end: '11:00',
    });
    const mondayWork = result.blocks.filter((b) => b.date === MON && b.taskId === work.id);
    expect(mondayWork.every((b) => endOf(b) <= 10 * 60 || startOf(b) >= 11 * 60)).toBe(true);
    // The exam's hour counts toward Monday's 7 hours.
    expect(minutesOn(result.blocks, MON)).toBeLessThanOrEqual(420);
  });
});

describe('calendar busy time (spec 3.8)', () => {
  it('reduces capacity by an accepted 2-hour event: 7 hours become 5', () => {
    const busy = [{ date: SUN, start: '10:00', end: '12:00' }];
    expect(dayCapacity(SUN, basePattern, [], busy).capacityMinutes).toBe(300);
    const result = schedule({
      tasks: [task({ estHours: 20 })],
      pattern: basePattern,
      today: SUN,
      busy,
    });
    expect(minutesOn(result.blocks, SUN)).toBe(300);
    expect(
      result.blocks
        .filter((b) => b.date === SUN)
        .every((b) => endOf(b) <= 600 || startOf(b) >= 720),
    ).toBe(true);
  });
});

describe('engine details', () => {
  it('adds a 10-minute break after 2 hours of continuous study', () => {
    const result = schedule({ tasks: [task({ estHours: 7 })], pattern: basePattern, today: SUN });
    expect(result.days[0]?.breaks).toContainEqual({ start: '11:00', end: '11:10' });
  });

  it('never splits a non-splittable task; a later task uses the time instead', () => {
    const filler = task({ estHours: 6, order: 1 });
    const mock = task({ type: 'practice', estHours: 1.5, order: 2, splittable: false });
    const short = task({ estHours: 0.5, order: 3 });
    const result = schedule({ tasks: [filler, mock, short], pattern: basePattern, today: SUN });
    const mockBlocks = result.blocks.filter((b) => b.taskId === mock.id);
    expect(mockBlocks).toHaveLength(1);
    expect(mockBlocks[0]?.minutes).toBe(90);
    expect(mockBlocks[0]?.date).toBe(MON);
    expect(result.blocks.find((b) => b.taskId === short.id)?.date).toBe(SUN);
  });

  it('respects "not before" dates and dependencies', () => {
    const signup = task({ type: 'admin', estHours: 0.25, order: 1, notBefore: MON });
    const course = task({ estHours: 2, order: 2, dependsOn: [signup.id] });
    const result = schedule({ tasks: [signup, course], pattern: basePattern, today: SUN });
    const s = result.blocks.find((b) => b.taskId === signup.id);
    const c = result.blocks.find((b) => b.taskId === course.id);
    expect(s).toMatchObject({ date: MON, start: '09:00', end: '09:15' });
    expect(c?.date).toBe(MON);
    expect(c && s && startOf(c) >= endOf(s)).toBe(true);
  });

  it('keeps a block the user locked in place', () => {
    const t = task({ estHours: 3 });
    const locked = {
      taskId: t.id,
      date: MON,
      start: '15:00',
      end: '16:00',
      minutes: 60,
      kind: 'locked' as const,
    };
    const result = schedule({
      tasks: [t],
      pattern: basePattern,
      today: SUN,
      lockedBlocks: [locked],
    });
    expect(result.blocks).toContainEqual(locked);
    expect(result.blocks.filter((b) => b.taskId === t.id).reduce((s, b) => s + b.minutes, 0)).toBe(
      180,
    );
  });

  it('reports a dependency cycle instead of looping', () => {
    const a = task({ id: 'cyc-a', estHours: 1, dependsOn: ['cyc-b'] });
    const b = task({ id: 'cyc-b', estHours: 1, dependsOn: ['cyc-a'] });
    const result = schedule({ tasks: [a, b], pattern: basePattern, today: SUN, horizonDays: 30 });
    expect(result.warnings.some((w) => w.kind === 'dependency_cycle')).toBe(true);
    expect(result.blocks).toHaveLength(0);
  });

  it('runs on an unrelated plan: weekday evenings, no lunch break', () => {
    const evenings = WeekPatternSchema.parse({
      studyWeekdays: [1, 2, 3, 4, 5],
      defaultHours: 2,
      windowStart: '19:00',
      windowEnd: '22:00',
      breakEveryHours: 1,
      breakMinutes: 5,
      timezone: 'Europe/London',
    });
    const html = task({ estHours: 6, order: 1 });
    const css = task({ estHours: 4, order: 2, dependsOn: [html.id] });
    const project = task({
      type: 'practice',
      estHours: 2,
      order: 3,
      splittable: false,
      dependsOn: [css.id],
    });
    const result = schedule({ tasks: [html, css, project], pattern: evenings, today: SUN });
    expect(result.warnings).toEqual([]);
    expect(result.blocks.every((b) => b.start >= '19:00' && b.end <= '22:00')).toBe(true);
    expect(minutesOn(result.blocks, SUN)).toBe(0); // Sunday is not a study day here
    expect(result.blocks.find((b) => b.taskId === project.id)?.minutes).toBe(120);
  });
});
