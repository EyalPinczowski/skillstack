import { describe, expect, it } from 'vitest';
import {
  MAX_PLAN_SKILL_IDS,
  parsePlanFile,
  TaskSchema,
  WeekPatternSchema,
  type PlanFileInput,
} from './schemas';

const pattern = {
  studyWeekdays: [0, 1, 2, 3, 4],
  defaultHours: 7,
  windowStart: '09:00',
  windowEnd: '17:30',
  lunchStart: '13:00',
  lunchEnd: '14:00',
  timezone: 'Asia/Jerusalem',
};

function plan(tasks: PlanFileInput['tasks']): PlanFileInput {
  return {
    formatVersion: 1,
    name: 'Test plan',
    startDate: '2026-11-01',
    weekPattern: pattern,
    tasks,
  };
}

describe('TaskSchema', () => {
  it('applies defaults so a minimal task is complete', () => {
    const task = TaskSchema.parse({
      id: 't1',
      title: 'Course',
      type: 'course',
      estHours: 3,
      order: 1,
    });
    expect(task).toMatchObject({
      doneHours: 0,
      status: 'pending',
      dependsOn: [],
      splittable: true,
      isAnchor: false,
      source: 'manual',
      lessons: [],
    });
  });

  it('requires a date and a start time on an anchor (exam) task', () => {
    const base = {
      id: 'x',
      title: 'Exam',
      type: 'cert_exam',
      estHours: 1.5,
      order: 1,
      isAnchor: true,
    };
    expect(TaskSchema.safeParse(base).success).toBe(false);
    expect(
      TaskSchema.safeParse({ ...base, anchorDate: '2026-11-23', anchorStartTime: '09:00' }).success,
    ).toBe(true);
  });

  it('rejects an anchor task that would end after 23:59', () => {
    const base = {
      id: 'x',
      title: 'Exam',
      type: 'cert_exam',
      estHours: 1,
      order: 1,
      isAnchor: true,
      anchorDate: '2026-11-23',
    };
    const late = TaskSchema.safeParse({ ...base, anchorStartTime: '23:00' });
    expect(late.success).toBe(false);
    expect(late.error?.issues[0]?.path).toEqual(['anchorStartTime']);
    expect(TaskSchema.safeParse({ ...base, anchorStartTime: '22:59' }).success).toBe(true);
  });

  it('rejects a task that depends on itself', () => {
    const result = TaskSchema.safeParse({
      id: 'a',
      title: 'A',
      type: 'course',
      estHours: 1,
      order: 1,
      dependsOn: ['a'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects malformed dates and times', () => {
    const base = { id: 'a', title: 'A', type: 'course', estHours: 1, order: 1 };
    expect(TaskSchema.safeParse({ ...base, notBefore: '2026-13-01' }).success).toBe(false);
    expect(
      TaskSchema.safeParse({ ...base, pinnedStart: { date: '2026-11-02', start: '9:00' } }).success,
    ).toBe(false);
  });
});

describe('WeekPatternSchema', () => {
  it('fills the spec defaults for breaks and the minimum block', () => {
    const p = WeekPatternSchema.parse(pattern);
    expect(p).toMatchObject({
      breakEveryHours: 2,
      breakMinutes: 10,
      minBlockMinutes: 30,
      hoursByWeekday: {},
    });
  });

  it('rejects a window that ends before it starts, and half a lunch break', () => {
    expect(WeekPatternSchema.safeParse({ ...pattern, windowEnd: '08:00' }).success).toBe(false);
    expect(WeekPatternSchema.safeParse({ ...pattern, lunchEnd: undefined }).success).toBe(false);
  });

  it('accepts a per-weekday override and rejects a bad weekday key', () => {
    expect(WeekPatternSchema.safeParse({ ...pattern, hoursByWeekday: { '4': 5 } }).success).toBe(
      true,
    );
    expect(WeekPatternSchema.safeParse({ ...pattern, hoursByWeekday: { '7': 5 } }).success).toBe(
      false,
    );
  });

  it('rejects a time zone the platform does not know, so exports cannot crash later', () => {
    for (const timezone of ['Asia/Jerusalam', 'Mars/Olympus', 'not a zone']) {
      const result = WeekPatternSchema.safeParse({ ...pattern, timezone });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['timezone']);
    }
    for (const timezone of ['Asia/Jerusalem', 'Europe/London', 'UTC']) {
      expect(WeekPatternSchema.safeParse({ ...pattern, timezone }).success).toBe(true);
    }
  });
});

describe('parsePlanFile', () => {
  const a = { id: 'a', title: 'A', type: 'course' as const, estHours: 2, order: 1 };

  it('accepts a valid plan', () => {
    expect(
      parsePlanFile(plan([a, { ...a, id: 'b', order: 2, dependsOn: ['a'] }])).tasks,
    ).toHaveLength(2);
  });

  it('rejects duplicate ids and unknown dependencies', () => {
    expect(() => parsePlanFile(plan([a, { ...a, order: 2 }]))).toThrow(/Duplicate task id/);
    expect(() => parsePlanFile(plan([{ ...a, dependsOn: ['nope'] }]))).toThrow(/unknown task/);
  });

  describe('skillIds', () => {
    const task = { id: 'a', title: 'A', type: 'course' as const, estHours: 2, order: 1 };
    const withSkills = (skillIds: unknown) =>
      ({ ...plan([task]), skillIds }) as unknown as PlanFileInput;

    it('is optional and stays absent', () => {
      expect('skillIds' in parsePlanFile(plan([task]))).toBe(false);
    });

    it('accepts a list of ids, the empty list and exactly the maximum', () => {
      expect(parsePlanFile(withSkills(['sql', 'python'])).skillIds).toEqual(['sql', 'python']);
      expect(parsePlanFile(withSkills([])).skillIds).toEqual([]);
      const max = Array.from({ length: MAX_PLAN_SKILL_IDS }, (_, i) => `s${i}`);
      expect(parsePlanFile(withSkills(max)).skillIds).toHaveLength(MAX_PLAN_SKILL_IDS);
    });

    it.each([
      ['a string', 'sql'],
      ['a number inside', ['sql', 7]],
      ['an empty id', ['']],
      ['an over-long id', ['x'.repeat(65)]],
      ['too many ids', Array.from({ length: MAX_PLAN_SKILL_IDS + 1 }, (_, i) => `s${i}`)],
    ])('rejects %s', (_label, value) => {
      expect(() => parsePlanFile(withSkills(value))).toThrow();
    });
  });
});
