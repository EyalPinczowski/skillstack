import { describe, expect, it } from 'vitest';
import { diffDays } from '../dates';
import {
  DayReviewInputSchema,
  type DayOverride,
  type DayReview,
  type Suggestion,
  type Task,
} from '../schemas';
import {
  applySuggestion,
  suggestAdjustments,
  suggestionId,
  suggestionOptions,
  type AdjustmentInput,
  type LogEntry,
} from './adjustments';
import { summarizeChanges } from './changes';
import { schedule } from './engine';
import { basePattern, task } from './test-helpers';

// 1 Nov 2026 is a Sunday. Study days (basePattern): Sun-Thu, 7 h. Fri and Sat are rest days.
const SUN = '2026-11-01';
const MON = '2026-11-02';
const TUE = '2026-11-03';
const WED = '2026-11-04';
const THU = '2026-11-05';
const FRI = '2026-11-06';
const NEXT_SUN = '2026-11-08';

function review(date: string, over: Partial<DayReview> = {}): DayReview {
  return { date, difficulty: 3, density: 3, energy: 3, note: '', outcomes: [], ...over };
}

function input(over: Partial<AdjustmentInput> = {}): AdjustmentInput {
  return { reviews: [], logs: [], tasks: [], pattern: basePattern, today: THU, ...over };
}

// A 6 h pattern: one more hour still fits the 7.5 h study window (09:00-17:30 minus lunch).
const roomy = { ...basePattern, defaultHours: 6 };

const rulesOf = (i: AdjustmentInput) => suggestAdjustments(i).map((s) => s.rule);

describe('rule 1: density "too much" two study days in a row (spec 3.4)', () => {
  it('fires at density 4 on two consecutive study days', () => {
    const [s] = suggestAdjustments(
      input({ reviews: [review(TUE, { density: 4 }), review(WED, { density: 4 })] }),
    );
    expect(s?.rule).toBe('density_too_high');
    expect(s?.proposedChange).toEqual({
      kind: 'capacityDelta',
      scope: { type: 'weekdays', weekdays: [0, 1, 2, 3, 4] },
      hours: -1,
    });
    expect(s?.evidence.reviewDates).toEqual([TUE, WED]);
    expect(s?.explanation).toContain('4/5');
    expect(s?.explanation).toContain('from 7 h to 6 h');
  });

  it('does not fire at density 3 (just below the threshold)', () => {
    const reviews = [review(TUE, { density: 4 }), review(WED, { density: 3 })];
    expect(rulesOf(input({ reviews }))).toEqual([]);
  });

  it('does not fire on a single heavy day', () => {
    expect(rulesOf(input({ reviews: [review(WED, { density: 5 })] }))).toEqual([]);
  });

  it('treats Thursday and the following Sunday as consecutive (Fri and Sat are rest days)', () => {
    const reviews = [review(THU, { density: 5 }), review(NEXT_SUN, { density: 4 })];
    const out = suggestAdjustments(input({ reviews, today: NEXT_SUN }));
    expect(out.map((s) => s.rule)).toEqual(['density_too_high']);
    expect(out[0]?.evidence.reviewDates).toEqual([THU, NEXT_SUN]);
  });

  it('does not treat Sunday and Tuesday as consecutive (Monday is a study day)', () => {
    const reviews = [review(SUN, { density: 5 }), review(TUE, { density: 5 })];
    expect(rulesOf(input({ reviews }))).toEqual([]);
  });

  it('a DayOverride rest day is skipped: Mon (off) makes Sun and Tue consecutive', () => {
    const overrides: DayOverride[] = [{ date: MON, isStudyDay: false }];
    const reviews = [review(SUN, { density: 5 }), review(TUE, { density: 5 })];
    expect(rulesOf(input({ reviews, overrides }))).toEqual(['density_too_high']);
  });

  it('a DayOverride extra study day breaks adjacency: Fri (on) sits between Thu and Sun', () => {
    const overrides: DayOverride[] = [{ date: FRI, isStudyDay: true }];
    const reviews = [review(THU, { density: 5 }), review(NEXT_SUN, { density: 5 })];
    expect(rulesOf(input({ reviews, overrides, today: NEXT_SUN }))).toEqual([]);
  });

  it('ignores a heavy review on a rest day', () => {
    const reviews = [review(THU, { density: 5 }), review(FRI, { density: 5 })];
    expect(rulesOf(input({ reviews, today: FRI }))).toEqual([]);
  });

  it('does not suggest going below the minimum daily capacity', () => {
    const pattern = { ...basePattern, defaultHours: 1.5 };
    const reviews = [review(TUE, { density: 4 }), review(WED, { density: 4 })];
    expect(rulesOf(input({ reviews, pattern }))).toEqual([]);
    const ok = { ...basePattern, defaultHours: 2 };
    expect(rulesOf(input({ reviews, pattern: ok }))).toEqual(['density_too_high']);
  });

  it('only reduces weekdays that can take it', () => {
    const pattern = { ...basePattern, hoursByWeekday: { '3': 1.5 } };
    const reviews = [review(TUE, { density: 4 }), review(WED, { density: 4 })];
    const [s] = suggestAdjustments(input({ reviews, pattern }));
    expect(s?.proposedChange).toMatchObject({ scope: { weekdays: [0, 1, 2, 4] } });
  });

  it('ignores evidence older than the lookback window and reviews after today', () => {
    const old = [review('2026-10-20', { density: 5 }), review('2026-10-21', { density: 5 })];
    expect(rulesOf(input({ reviews: old }))).toEqual([]);
    const future = [review(THU, { density: 5 }), review(NEXT_SUN, { density: 5 })];
    expect(rulesOf(input({ reviews: future }))).toEqual([]);
  });
});

describe('rule 2: density "too light" (spec 3.4)', () => {
  it('fires at density 2 with both options as alternatives', () => {
    const [s] = suggestAdjustments(
      input({ reviews: [review(WED, { density: 2 })], pattern: roomy }),
    );
    expect(s?.rule).toBe('density_too_low');
    expect(s?.proposedChange).toEqual({
      kind: 'capacityDelta',
      scope: { type: 'weekdays', weekdays: [0, 1, 2, 3, 4] },
      hours: 1,
    });
    expect(s?.alternatives).toEqual([{ kind: 'pullForward', date: NEXT_SUN, hours: 1 }]);
    expect(s?.explanation).toContain('2/5');
  });

  it('does not fire at density 3', () => {
    expect(rulesOf(input({ reviews: [review(WED, { density: 3 })], pattern: roomy }))).toEqual([]);
  });

  it('offers only what fits in the daily window', () => {
    // The 09:00-17:30 window minus lunch holds 7.5 h: 7 h + 1 h does not fit.
    const full = { ...basePattern, defaultHours: 7, hoursByWeekday: { '1': 6 } };
    const [s] = suggestAdjustments(
      input({ reviews: [review(WED, { density: 1 })], pattern: full }),
    );
    expect(s?.proposedChange).toMatchObject({ scope: { weekdays: [1] } });
    expect(s?.alternatives).toEqual([]);
  });

  it('offers nothing when no option fits', () => {
    const full = { ...basePattern, defaultHours: 7.5 };
    expect(rulesOf(input({ reviews: [review(WED, { density: 1 })], pattern: full }))).toEqual([]);
  });

  it('uses the latest light review only', () => {
    const reviews = [review(MON, { density: 1 }), review(WED, { density: 2 })];
    const out = suggestAdjustments(input({ reviews, pattern: roomy }));
    expect(out).toHaveLength(1);
    expect(out[0]?.key).toBe(WED);
  });
});

describe('rule 3: actual vs estimated hours per task type (spec 3.4)', () => {
  // doneHours 0: the hours come from the logs unless a test says some were imported.
  const done = (id: string, est: number, type: Task['type'] = 'course', imported = 0) =>
    task({ id, estHours: est, type, status: 'done', doneHours: imported });
  const logsFor = (hours: Record<string, number>): LogEntry[] =>
    Object.entries(hours).map(([taskId, h]) => ({ taskId, date: TUE, hours: h }));
  const base = (actualEach: number) => ({
    tasks: [done('a', 10), done('b', 10), done('c', 10), task({ id: 'next', estHours: 8 })],
    logs: logsFor({ a: actualEach, b: actualEach, c: actualEach }),
  });

  it('fires just above 25% over (26%) and says so in plain English', () => {
    const [s] = suggestAdjustments(input(base(12.6)));
    expect(s?.rule).toBe('estimate_drift');
    expect(s?.proposedChange).toEqual({
      kind: 'estimateUpdate',
      taskType: 'course',
      factor: 1.25,
      taskIds: ['next'],
    });
    expect(s?.explanation).toContain('Courses are taking you 25% longer than estimated');
    expect(s?.explanation).toContain('37.8 h actual vs 30 h estimated');
  });

  it('does not fire at exactly 25% over, nor at 24%', () => {
    expect(rulesOf(input(base(12.5)))).toEqual([]);
    expect(rulesOf(input(base(12.4)))).toEqual([]);
  });

  it('fires just above 25% under, with a factor below 1', () => {
    expect(rulesOf(input(base(7.5)))).toEqual([]);
    const [s] = suggestAdjustments(input(base(7.4)));
    expect(s?.proposedChange).toMatchObject({ kind: 'estimateUpdate', factor: 0.75 });
    expect(s?.explanation).toContain('25% shorter');
  });

  it('rounds the factor sensibly (30% -> 1.3, 32% -> 1.3, 33% -> 1.35)', () => {
    const factor = (each: number) => {
      const [s] = suggestAdjustments(input(base(each)));
      return s?.proposedChange.kind === 'estimateUpdate' ? s.proposedChange.factor : null;
    };
    expect(factor(13)).toBe(1.3);
    expect(factor(13.2)).toBe(1.3);
    expect(factor(13.3)).toBe(1.35);
    expect(suggestAdjustments(input(base(13)))[0]?.explanation).toContain('30% longer');
  });

  it('needs at least 3 completed tasks of the type', () => {
    const two = {
      tasks: [done('a', 10), done('b', 10), task({ id: 'next', estHours: 8 })],
      logs: logsFor({ a: 20, b: 20 }),
    };
    expect(rulesOf(input(two))).toEqual([]);
  });

  it('does not count completed tasks without logged hours as data points', () => {
    const i = base(20);
    i.logs = logsFor({ a: 20, b: 20 });
    expect(rulesOf(input(i))).toEqual([]);
  });

  it('counts hours imported with the plan: logs alone must not look shorter than estimated', () => {
    // Each task: 10 h estimated, 10 h done of which 6 h came with the plan file and 4 h are logged.
    // Reading the logs only gives 12 h vs 30 h (a wrong "60% shorter"); the truth is on target.
    const i = {
      tasks: [
        done('a', 10, 'course', 10),
        done('b', 10, 'course', 10),
        done('c', 10, 'course', 10),
        task({ id: 'next', estHours: 8 }),
      ],
      logs: logsFor({ a: 4, b: 4, c: 4 }),
    };
    expect(rulesOf(input(i))).toEqual([]);
  });

  it('counts imported hours of a task that has no logs at all, and states the real total', () => {
    const i = {
      tasks: [
        done('a', 10, 'course', 15),
        done('b', 10, 'course', 15),
        done('c', 10, 'course', 15),
        task({ id: 'next', estHours: 8 }),
      ],
      logs: [],
    };
    const [s] = suggestAdjustments(input(i));
    expect(s?.proposedChange).toMatchObject({ kind: 'estimateUpdate', factor: 1.5 });
    expect(s?.explanation).toContain('45 h actual vs 30 h estimated');
  });

  it('does not add logs on top of doneHours (doneHours already includes them)', () => {
    const i = {
      tasks: [
        done('a', 10, 'course', 13),
        done('b', 10, 'course', 13),
        done('c', 10, 'course', 13),
        task({ id: 'next', estHours: 8 }),
      ],
      logs: logsFor({ a: 13, b: 13, c: 13 }),
    };
    expect(suggestAdjustments(input(i))[0]?.explanation).toContain('39 h actual vs 30 h');
  });

  it('judges the aggregate, not single tasks', () => {
    const i = {
      tasks: [done('a', 10), done('b', 10), done('c', 10), task({ id: 'next', estHours: 8 })],
      logs: logsFor({ a: 20, b: 5, c: 5 }), // 30 h actual vs 30 h estimated
    };
    expect(rulesOf(input(i))).toEqual([]);
  });

  it('keeps types apart and skips exams', () => {
    const tasks = [
      done('a', 10),
      done('b', 10),
      done('p1', 2, 'practice'),
      done('p2', 2, 'practice'),
      done('p3', 2, 'practice'),
      task({ id: 'n1', estHours: 4, type: 'practice' }),
      task({ id: 'n2', estHours: 4, type: 'course' }),
      done('e1', 3, 'cert_exam'),
      done('e2', 3, 'cert_exam'),
      done('e3', 3, 'cert_exam'),
      task({ id: 'n3', estHours: 3, type: 'cert_exam' }),
    ];
    const logs = logsFor({ a: 30, b: 30, p1: 4, p2: 4, p3: 4, e1: 9, e2: 9, e3: 9 });
    const out = suggestAdjustments(input({ tasks, logs }));
    expect(
      out.map((s) => s.proposedChange.kind === 'estimateUpdate' && s.proposedChange.taskType),
    ).toEqual(['practice']);
  });

  it('offers nothing when no task of that type is left to update', () => {
    const i = base(20);
    i.tasks = i.tasks.slice(0, 3);
    expect(rulesOf(input(i))).toEqual([]);
  });

  it('ignores logs after today', () => {
    const i = base(20);
    i.logs = i.logs.map((l) => ({ ...l, date: NEXT_SUN }));
    expect(rulesOf(input(i))).toEqual([]);
  });
});

describe('rule 4: high difficulty on an area (spec 3.4)', () => {
  const tasks = [
    task({ id: 'sql1', estHours: 4, provider: 'Mode', order: 1, status: 'done' }),
    task({ id: 'py1', estHours: 4, provider: 'Kaggle', order: 2 }),
    task({ id: 'sql2', estHours: 4, provider: 'Mode', order: 3, title: 'SQL joins' }),
    task({ id: 'sql3', estHours: 4, provider: 'Mode', order: 4 }),
  ];
  const hardReview = (difficulty: number) =>
    review(WED, { difficulty, outcomes: [{ taskId: 'sql1', outcome: 'done' }] });

  it('fires at difficulty 4 and targets the next task in the same area', () => {
    const [s] = suggestAdjustments(input({ tasks, reviews: [hardReview(4)] }));
    expect(s?.rule).toBe('difficulty_practice');
    expect(s?.proposedChange).toEqual({ kind: 'extraPractice', afterTaskId: 'sql2', hours: 1 });
    expect(s?.explanation).toContain('4/5');
    expect(s?.explanation).toContain('SQL joins');
    expect(s?.evidence).toEqual({ reviewDates: [WED], taskIds: ['sql1'] });
  });

  it('does not fire at difficulty 3', () => {
    expect(rulesOf(input({ tasks, reviews: [hardReview(3)] }))).toEqual([]);
  });

  it("finds the day's tasks from the logs when the review has no outcomes", () => {
    const logs: LogEntry[] = [{ taskId: 'sql1', date: WED, hours: 2 }];
    const out = suggestAdjustments(
      input({ tasks, logs, reviews: [review(WED, { difficulty: 5 })] }),
    );
    expect(out).toHaveLength(1);
  });

  it('ignores tasks marked not done', () => {
    const r = review(WED, { difficulty: 5, outcomes: [{ taskId: 'sql1', outcome: 'not_done' }] });
    expect(rulesOf(input({ tasks, reviews: [r] }))).toEqual([]);
  });

  it('uses supplied task areas (e.g. catalog skills) over provider', () => {
    const taskAreas = { sql1: 'data', py1: 'data', sql2: 'other', sql3: 'other' };
    const [s] = suggestAdjustments(input({ tasks, taskAreas, reviews: [hardReview(5)] }));
    expect(s?.proposedChange).toMatchObject({ afterTaskId: 'py1' });
  });

  it('falls back to the task type, and skips exams as targets', () => {
    const t = [
      task({ id: 'a', estHours: 2, order: 1, status: 'done' }),
      task({ id: 'x', estHours: 2, order: 2, type: 'cert_exam' }),
      task({ id: 'b', estHours: 2, order: 3 }),
    ];
    const r = review(WED, {
      difficulty: 5,
      outcomes: [{ taskId: 'a', outcome: 'partial', hours: 1 }],
    });
    const [s] = suggestAdjustments(input({ tasks: t, reviews: [r] }));
    expect(s?.proposedChange).toMatchObject({ afterTaskId: 'b' });
  });

  it('offers nothing when the area has no further task', () => {
    const t = tasks.filter((x) => x.id !== 'sql2' && x.id !== 'sql3');
    expect(rulesOf(input({ tasks: t, reviews: [hardReview(5)] }))).toEqual([]);
  });
});

describe('decided suggestions and new evidence', () => {
  const heavy = [review(TUE, { density: 4 }), review(WED, { density: 4 })];

  it('does not re-offer a rejected suggestion for the same evidence', () => {
    const [s] = suggestAdjustments(input({ reviews: heavy }));
    const decided = [{ rule: s!.rule, key: s!.key, decision: 'rejected' as const }];
    expect(suggestAdjustments(input({ reviews: heavy, decided }))).toEqual([]);
  });

  it('offers a new suggestion with a new id once new evidence arrives', () => {
    const [first] = suggestAdjustments(input({ reviews: heavy }));
    const decided = [{ rule: first!.rule, key: first!.key, decision: 'rejected' as const }];
    const reviews = [...heavy, review(THU, { density: 5 })];
    const [second] = suggestAdjustments(input({ reviews, decided }));
    expect(second?.rule).toBe('density_too_high');
    expect(second?.id).not.toBe(first?.id);
    expect(second?.evidence.reviewDates).toEqual([WED, THU]);
  });

  it('does not reuse review days of an accepted suggestion', () => {
    const [first] = suggestAdjustments(input({ reviews: heavy }));
    const decided = [
      {
        rule: first!.rule,
        key: first!.key,
        decision: 'accepted' as const,
        evidence: first!.evidence,
      },
    ];
    const reviews = [...heavy, review(THU, { density: 5 })];
    expect(suggestAdjustments(input({ reviews, decided }))).toEqual([]);
  });

  it('a rejected estimate update returns only after another task completes', () => {
    const mk = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        task({ id: `d${i}`, estHours: 10, status: 'done', doneHours: 10 }),
      );
    const logs = (n: number): LogEntry[] =>
      Array.from({ length: n }, (_, i) => ({ taskId: `d${i}`, date: TUE, hours: 14 }));
    const next = task({ id: 'next', estHours: 8 });
    const [a] = suggestAdjustments(input({ tasks: [...mk(3), next], logs: logs(3) }));
    const decided = [{ rule: a!.rule, key: a!.key, decision: 'rejected' as const }];
    expect(suggestAdjustments(input({ tasks: [...mk(3), next], logs: logs(3), decided }))).toEqual(
      [],
    );
    const [b] = suggestAdjustments(input({ tasks: [...mk(4), next], logs: logs(4), decided }));
    expect(b?.id).not.toBe(a?.id);
  });

  it('an accepted estimate update does not count its completed tasks again', () => {
    const tasks = [
      ...['a', 'b', 'c', 'd'].map((id) => task({ id, estHours: 10, status: 'done' as const })),
      task({ id: 'next', estHours: 8 }),
    ];
    const logs = ['a', 'b', 'c', 'd'].map((taskId) => ({ taskId, date: TUE, hours: 14 }));
    const decided = [
      {
        rule: 'estimate_drift' as const,
        key: 'course:a,b,c',
        decision: 'accepted' as const,
        evidence: { reviewDates: [], taskIds: ['a', 'b', 'c'] },
      },
    ];
    expect(suggestAdjustments(input({ tasks, logs, decided }))).toEqual([]);
  });
});

describe('ids and ordering', () => {
  it('derives the id deterministically from rule and key', () => {
    expect(suggestionId('density_too_low', WED)).toBe(suggestionId('density_too_low', WED));
    expect(suggestionId('density_too_low', WED)).not.toBe(suggestionId('density_too_low', THU));
    expect(suggestionId('density_too_low', WED)).not.toBe(suggestionId('density_too_high', WED));
    const [s] = suggestAdjustments(
      input({ reviews: [review(WED, { density: 2 })], pattern: roomy }),
    );
    expect(s?.id).toBe(suggestionId('density_too_low', WED));
  });

  it('lists suggestions by rule order then key, whatever the input order', () => {
    const tasks = [
      task({ id: 'a', estHours: 4, order: 1, type: 'practice', status: 'done' }),
      task({ id: 'b', estHours: 4, order: 2, type: 'practice' }),
      ...['c', 'd', 'e'].map((id) => task({ id, estHours: 10, status: 'done' as const })),
      task({ id: 'f', estHours: 10 }),
    ];
    const logs: LogEntry[] = ['c', 'd', 'e'].map((taskId) => ({ taskId, date: TUE, hours: 20 }));
    const reviews = [
      review(TUE, { density: 5 }),
      review(WED, { density: 4, difficulty: 5, outcomes: [{ taskId: 'a', outcome: 'done' }] }),
    ];
    const a = suggestAdjustments(input({ tasks, logs, reviews }));
    const b = suggestAdjustments(
      input({
        tasks: [...tasks].reverse(),
        logs: [...logs].reverse(),
        reviews: [...reviews].reverse(),
      }),
    );
    expect(a.map((s) => s.rule)).toEqual([
      'density_too_high',
      'estimate_drift',
      'difficulty_practice',
    ]);
    expect(b).toEqual(a);
  });
});

describe('applySuggestion: estimates never drop below the hours already done', () => {
  const update = (factor: number, ids: string[]): Suggestion => ({
    id: 'sg_x',
    rule: 'estimate_drift',
    key: 'k',
    title: 't',
    explanation: 'e',
    proposedChange: { kind: 'estimateUpdate', taskType: 'course', factor, taskIds: ids },
    alternatives: [],
    evidence: { reviewDates: [], taskIds: [] },
  });

  it('raises an in-progress task to its done hours (est 5, done 4, factor 0.6 -> 4, not 3)', () => {
    const tasks = [task({ id: 'p', estHours: 5, doneHours: 4, status: 'in_progress' })];
    const out = applySuggestion(tasks, basePattern, [], update(0.6, ['p']));
    expect(out.tasks[0]?.estHours).toBe(4);
  });

  it('rounds the floor up to a quarter hour and leaves higher results alone', () => {
    const tasks = [
      task({ id: 'p', estHours: 5, doneHours: 4.1, status: 'in_progress' }),
      task({ id: 'q', estHours: 5, doneHours: 1, status: 'in_progress' }),
    ];
    const out = applySuggestion(tasks, basePattern, [], update(0.6, ['p', 'q']));
    expect(out.tasks.map((t) => t.estHours)).toEqual([4.25, 3]);
  });
});

describe('applySuggestion', () => {
  const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

  it('is a round trip with schedule(): reducing capacity pushes the finish date back', () => {
    const tasks = [task({ id: 'big', estHours: 28, order: 1 })];
    const before = schedule({ tasks, pattern: basePattern, today: SUN });
    expect(before.finishDate).toBe(WED); // 4 days x 7 h

    const [s] = suggestAdjustments(
      input({ tasks, reviews: [review(TUE, { density: 4 }), review(WED, { density: 4 })] }),
    );
    const applied = applySuggestion(tasks, basePattern, [], s!);
    const after = schedule({ ...applied, today: SUN });
    expect(after.finishDate).toBe(THU); // 6 h a day: 5 days
    const summary = summarizeChanges(before, after, {
      today: SUN,
      pattern: applied.pattern,
      overrides: applied.overrides,
    });
    expect(summary.finishShiftStudyDays).toBe(1);
    expect(summary.text).toContain('pushed back by 1 study day');
  });

  it('adding an hour or pulling forward both finish earlier; they differ in reach', () => {
    const tasks = [task({ id: 'big', estHours: 28, order: 1 })];
    const [s] = suggestAdjustments(
      input({ tasks, today: SUN, reviews: [review(SUN, { density: 1 })], pattern: roomy }),
    );
    const pattern = roomy;
    const add = applySuggestion(tasks, pattern, [], s!, 0);
    expect(schedule({ ...add, today: SUN }).finishDate).toBe(WED); // 7 h x 4 days
    expect(schedule({ tasks, pattern, today: SUN }).finishDate).toBe(THU);
    const pull = applySuggestion(tasks, pattern, [], s!, 1);
    expect(pull.pattern).toBe(pattern);
    expect(pull.overrides).toEqual([{ date: MON, isStudyDay: true, capacityHours: 7 }]);
    expect(() => applySuggestion(tasks, pattern, [], s!, 2)).toThrow(RangeError);
  });

  it('estimate updates scale only the listed tasks and push the finish later', () => {
    const next = task({ id: 'next', estHours: 14, order: 9 });
    const other = task({ id: 'other', estHours: 14, order: 10, type: 'practice' });
    const s = suggestAdjustments(
      input({
        tasks: [
          ...['a', 'b', 'c'].map((id) => task({ id, estHours: 10, status: 'done' as const })),
          next,
          other,
        ],
        logs: ['a', 'b', 'c'].map((taskId) => ({ taskId, date: TUE, hours: 15 })),
      }),
    )[0]!;
    expect(s.explanation).toContain('50% longer');
    const applied = applySuggestion([next, other], basePattern, [], s);
    expect(applied.tasks.map((t) => t.estHours)).toEqual([21, 14]);
    const before = schedule({ tasks: [next, other], pattern: basePattern, today: SUN });
    const after = schedule({ ...applied, today: SUN });
    expect(before.finishDate).toBe(WED); // 28 h
    expect(after.finishDate).toBe(THU); // 35 h
  });

  it('extra practice inserts a dependent task after the target and shifts later orders', () => {
    const tasks = [
      task({ id: 'a', estHours: 4, order: 1, provider: 'P', status: 'done' }),
      task({ id: 'b', estHours: 4, order: 2, provider: 'P' }),
      task({ id: 'c', estHours: 4, order: 3, provider: 'Q' }),
    ];
    const s = suggestAdjustments(
      input({
        tasks,
        reviews: [review(WED, { difficulty: 5, outcomes: [{ taskId: 'a', outcome: 'done' }] })],
      }),
    )[0]!;
    const applied = applySuggestion(tasks, basePattern, [], s);
    const sorted = [...applied.tasks].sort((x, y) => x.order - y.order).map((t) => t.id);
    expect(sorted).toEqual(['a', 'b', `practice-${s.id}`, 'c']);
    expect(applied.tasks.find((t) => t.id === `practice-${s.id}`)).toMatchObject({
      type: 'practice',
      estHours: 1,
      dependsOn: ['b'],
      source: 'auto',
    });
    // Idempotent: applying again changes nothing more.
    expect(applySuggestion(applied.tasks, basePattern, [], s).tasks).toEqual(applied.tasks);
    const total = (r: ReturnType<typeof schedule>) => r.blocks.reduce((m, b) => m + b.minutes, 0);
    const before = schedule({ tasks, pattern: basePattern, today: SUN });
    const after = schedule({ ...applied, today: SUN });
    expect(total(after) - total(before)).toBe(60);
  });

  it('weekday deltas keep other weekdays and clamp to 0-24 h', () => {
    const s = suggestAdjustments(
      input({ reviews: [review(WED, { density: 2 })], pattern: roomy }),
    )[0]!;
    const pattern = { ...roomy, hoursByWeekday: { '5': 3 } };
    const out = applySuggestion([], pattern, [], s);
    expect(out.pattern.hoursByWeekday).toMatchObject({ '5': 3, '0': 7, '4': 7 });
    const neg = { ...s, proposedChange: { ...s.proposedChange, hours: -100 } } as typeof s;
    expect(applySuggestion([], basePattern, [], neg).pattern.hoursByWeekday['0']).toBe(0);
  });

  it('date-range deltas edit study days only and keep other override fields', () => {
    const s = {
      ...suggestAdjustments(input({ reviews: [review(WED, { density: 2 })], pattern: roomy }))[0]!,
      proposedChange: {
        kind: 'capacityDelta' as const,
        scope: { type: 'dateRange' as const, from: THU, to: NEXT_SUN },
        hours: -2,
      },
    };
    const existing: DayOverride[] = [{ date: NEXT_SUN, isStudyDay: true, capacityHours: 4 }];
    const out = applySuggestion([], basePattern, existing, s);
    expect(out.overrides).toEqual([
      { date: THU, isStudyDay: true, capacityHours: 5 },
      { date: NEXT_SUN, isStudyDay: true, capacityHours: 2 },
    ]);
    expect(diffDays(THU, NEXT_SUN)).toBe(3);
  });

  it('never mutates its inputs', () => {
    const tasks = [task({ id: 'a', estHours: 4, order: 1 })];
    const s = suggestAdjustments(
      input({ reviews: [review(WED, { density: 2 })], pattern: roomy }),
    )[0]!;
    const snapshot = plain({ tasks, pattern: basePattern, s });
    for (let i = 0; i < 2; i++) applySuggestion(tasks, basePattern, [], s, i);
    expect(plain({ tasks, pattern: basePattern, s })).toEqual(snapshot);
    expect(suggestionOptions(s)).toHaveLength(2);
  });
});

describe('DayReviewInputSchema', () => {
  const valid = { date: WED, difficulty: 3, density: 3, energy: 3 };

  it('accepts a minimal review and fills defaults', () => {
    expect(DayReviewInputSchema.parse(valid)).toMatchObject({ note: '', outcomes: [] });
  });

  it.each([0, 6, 2.5])('rejects a scale value of %s', (v) => {
    for (const field of ['difficulty', 'density', 'energy']) {
      expect(DayReviewInputSchema.safeParse({ ...valid, [field]: v }).success).toBe(false);
    }
  });

  it('limits the note to 2000 characters', () => {
    expect(DayReviewInputSchema.safeParse({ ...valid, note: 'x'.repeat(2000) }).success).toBe(true);
    expect(DayReviewInputSchema.safeParse({ ...valid, note: 'x'.repeat(2001) }).success).toBe(
      false,
    );
  });

  it('needs hours for a partial outcome and rejects unknown outcomes', () => {
    const outcome = (o: object) =>
      DayReviewInputSchema.safeParse({ ...valid, outcomes: [o] }).success;
    expect(outcome({ taskId: 't', outcome: 'partial' })).toBe(false);
    expect(outcome({ taskId: 't', outcome: 'partial', hours: 1.5 })).toBe(true);
    expect(outcome({ taskId: 't', outcome: 'partial', hours: 0 })).toBe(false);
    expect(outcome({ taskId: 't', outcome: 'done' })).toBe(true);
    expect(outcome({ taskId: 't', outcome: 'not_done', reason: 'sick' })).toBe(true);
    expect(outcome({ taskId: 't', outcome: 'not_done', hours: 1 })).toBe(false);
    expect(outcome({ taskId: 't', outcome: 'skipped' })).toBe(false);
  });

  it('rejects the same task twice and a bad date', () => {
    const o = { taskId: 't', outcome: 'done' };
    expect(DayReviewInputSchema.safeParse({ ...valid, outcomes: [o, o] }).success).toBe(false);
    expect(DayReviewInputSchema.safeParse({ ...valid, date: '2026-02-30' }).success).toBe(false);
  });
});
