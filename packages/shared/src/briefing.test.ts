import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildBriefing, BriefingSchema, formatDuration, type BriefingInput } from './briefing';
import { schedule } from './scheduling/engine';
import { basePattern, task } from './scheduling/test-helpers';
import type { Block, Task } from './schemas';

const DAY = '2026-11-02'; // a Monday: a study day in basePattern (Sunday to Thursday)

const block = (taskId: string, start: string, end: string, minutes: number, date = DAY): Block => ({
  taskId,
  date,
  start,
  end,
  minutes,
  kind: 'study',
});

const input = (over: Partial<BriefingInput> = {}): BriefingInput => ({
  date: DAY,
  blocks: [],
  tasks: [],
  pattern: basePattern,
  ...over,
});

describe('formatDuration', () => {
  it.each([
    [0, '0 minutes'],
    [1, '1 minute'],
    [45, '45 minutes'],
    [60, '1 hour'],
    [90, '1 hour 30 minutes'],
    [120, '2 hours'],
  ])('%i minutes is %s', (minutes, text) => {
    expect(formatDuration(minutes)).toBe(text);
  });
});

describe('buildBriefing', () => {
  const sql = task({
    id: 'sql',
    title: 'Intro to SQL',
    type: 'course',
    estHours: 4,
    doneHours: 1,
    provider: 'Kaggle',
    url: 'https://example.com/sql',
    lessons: [
      { title: 'Select', url: 'https://example.com/sql/select', estMinutes: 30, needsCheck: true },
      { title: 'Joins', needsCheck: false },
    ],
  });
  const mock = task({
    id: 'mock',
    title: 'Mock interview',
    type: 'practice',
    estHours: 1,
    dependsOn: ['sql'],
    howToSteps: ['Set a timer', 'Answer aloud'],
    promptTemplate: 'Interview me about {topic}',
  });
  const exam = task({
    id: 'exam',
    title: 'Final exam',
    type: 'cert_exam',
    estHours: 2,
    dependsOn: ['mock'],
    isAnchor: true,
    anchorDate: '2026-11-05',
    anchorStartTime: '10:00',
    isCertificate: true,
    certificateName: 'Data Analyst Associate',
  });
  const blocks = [
    block('mock', '12:00', '13:00', 60),
    block('sql', '09:00', '10:30', 90),
    block('sql', '10:45', '11:15', 30),
  ];

  it('writes the overview, tasks and order from templates', () => {
    const b = buildBriefing(input({ blocks, tasks: [sql, mock, exam] }));
    expect(b.overview).toBe(
      'Today is 3 hours of study: 1 course and 1 practice. ' +
        'This work leads toward Data Analyst Associate, on 2026-11-05, in 3 study days.',
    );
    expect(b.suggestedOrder).toEqual([
      { taskId: 'sql', start: '09:00', end: '10:30' },
      { taskId: 'sql', start: '10:45', end: '11:15' },
      { taskId: 'mock', start: '12:00', end: '13:00' },
    ]);
    expect(b.tasks.map((t) => t.taskId)).toEqual(['sql', 'mock']);
    const [first, second] = b.tasks;
    expect(first).toMatchObject({
      plannedMinutes: 120,
      start: '09:00',
      end: '11:15',
      provider: 'Kaggle',
      url: 'https://example.com/sql',
      successCriteria: null,
      promptTemplate: null,
      carriedOver: false,
      what: 'Study "Intro to SQL" on Kaggle: 2 hours today. It has 2 lessons. 3 hours remain in total.',
    });
    expect(first!.lessons).toEqual([
      { title: 'Select', url: 'https://example.com/sql/select', estMinutes: 30, needsCheck: true },
      { title: 'Joins', needsCheck: false },
    ]);
    expect(second).toMatchObject({
      howToSteps: ['Set a timer', 'Answer aloud'],
      promptTemplate: 'Interview me about {topic}',
      successCriteria:
        'You are done when you have completed all 2 steps and written down one thing to improve next time.',
    });
    expect(BriefingSchema.parse(b)).toEqual(b);
  });

  it('uses the task notes as the success criteria when present', () => {
    const p = task({ id: 'p', type: 'practice', estHours: 1, notes: ' Score at least 7/10 ' });
    const b = buildBriefing(input({ blocks: [block('p', '09:00', '10:00', 60)], tasks: [p] }));
    expect(b.tasks[0]!.successCriteria).toBe('Score at least 7/10');
  });

  it('falls back to a generic success criterion for a practice with nothing else', () => {
    const p = task({ id: 'p', type: 'practice', estHours: 1 });
    const b = buildBriefing(input({ blocks: [block('p', '09:00', '10:00', 60)], tasks: [p] }));
    expect(b.tasks[0]!.successCriteria).toBe(
      'You are done when you have finished the session and written down one thing that went well and one thing to improve.',
    );
  });

  it('mentions work carried over from an earlier day, and flags the task', () => {
    const b = buildBriefing(
      input({
        blocks: [block('sql', '09:00', '11:00', 120)],
        tasks: [sql],
        // 3 hours were planned earlier but only 1 hour is done.
        earlierBlocks: [block('sql', '09:00', '12:00', 180, '2026-11-01')],
      }),
    );
    expect(b.tasks[0]!.carriedOver).toBe(true);
    expect(b.overview).toContain('Carried over from an earlier day: "Intro to SQL".');
  });

  it('does not call a task carried over when its earlier plan was done', () => {
    const b = buildBriefing(
      input({
        blocks: [block('sql', '09:00', '11:00', 120)],
        tasks: [{ ...sql, doneHours: 3 }],
        earlierBlocks: [block('sql', '09:00', '12:00', 180, '2026-11-01')],
      }),
    );
    expect(b.tasks[0]!.carriedOver).toBe(false);
    expect(b.overview).not.toContain('Carried over');
  });

  it('adds a warning sentence when an anchor is at risk', () => {
    const b = buildBriefing(
      input({
        blocks,
        tasks: [sql, mock, exam],
        warnings: [
          {
            kind: 'anchor_at_risk',
            taskId: 'exam',
            anchorDate: '2026-11-05',
            anchorStartTime: '10:00',
            shortfallMinutes: 90,
            lateTaskIds: ['mock'],
            options: [{ kind: 'add_day' }],
          },
        ],
      }),
    );
    expect(b.overview).toMatch(
      / Warning: Data Analyst Associate on 2026-11-05 is at risk: 1 hour 30 minutes of the study before it does not fit\. Review the options in the schedule\.$/,
    );
  });

  it('describes a rest day, with the next anchor when there is one', () => {
    const rest = buildBriefing(input({ date: '2026-10-30', tasks: [exam] })); // a Friday
    expect(rest.overview).toBe(
      'Today is a rest day with nothing scheduled. ' +
        'Your next fixed date is Data Analyst Associate, on 2026-11-05, in 5 study days.',
    );
  });

  it('handles a plan with no anchor', () => {
    const b = buildBriefing(
      input({
        blocks: [block('sql', '09:00', '10:00', 60)],
        tasks: [sql],
        finishDate: '2026-12-01',
      }),
    );
    expect(b.overview).toBe(
      'Today is 1 hour of study: 1 course. The plan currently finishes on 2026-12-01.',
    );
    const bare = buildBriefing(
      input({ blocks: [block('sql', '09:00', '10:00', 60)], tasks: [sql] }),
    );
    expect(bare.overview).toBe(
      'Today is 1 hour of study: 1 course. Work through the blocks in the suggested order and log your hours at the end.',
    );
  });

  it('says an exam today is today', () => {
    const e = { ...exam, anchorDate: DAY, dependsOn: [] };
    const b = buildBriefing(input({ blocks: [block('exam', '10:00', '12:00', 120)], tasks: [e] }));
    expect(b.overview).toContain('leads toward Data Analyst Associate, today.');
    expect(b.tasks[0]!.what).toBe('Sit "Final exam" at 10:00; the date is fixed.');
  });

  it('omits a link the task does not have', () => {
    const plain = task({
      id: 'a',
      title: 'Read',
      estHours: 1,
      lessons: [{ title: 'L', needsCheck: false }],
    });
    const b = buildBriefing(input({ blocks: [block('a', '09:00', '10:00', 60)], tasks: [plain] }));
    expect(JSON.stringify(b)).not.toContain('http');
    expect(b.tasks[0]).not.toHaveProperty('url');
    expect(b.tasks[0]).not.toHaveProperty('provider');
    expect(b.tasks[0]!.lessons[0]).not.toHaveProperty('url');
  });

  it('ignores blocks of other dates and of unknown tasks', () => {
    const b = buildBriefing(
      input({
        blocks: [
          block('sql', '09:00', '10:00', 60),
          block('sql', '09:00', '10:00', 60, '2026-11-03'),
          block('ghost', '11:00', '12:00', 60),
        ],
        tasks: [sql],
      }),
    );
    expect(b.tasks.map((t) => t.taskId)).toEqual(['sql']);
    expect(b.suggestedOrder).toHaveLength(1);
  });
});

// ---- property tests --------------------------------------------------------------------------

const typeArb = fc.constantFrom<Task['type']>(
  'course',
  'cert_exam',
  'practice',
  'admin',
  'cv_update',
);

const planArb = fc
  .array(
    fc.record({
      type: typeArb,
      hours: fc.constantFrom(0.5, 1, 2, 3, 6),
      provider: fc.option(fc.constantFrom('Kaggle', 'Coursera'), { nil: undefined }),
      withUrl: fc.boolean(),
      lessons: fc.array(fc.record({ withUrl: fc.boolean(), check: fc.boolean() }), {
        maxLength: 3,
      }),
      steps: fc.integer({ min: 0, max: 3 }),
      anchorOffset: fc.option(fc.integer({ min: 0, max: 14 }), { nil: undefined }),
      cert: fc.boolean(),
      done: fc.constantFrom(0, 0.5),
    }),
    { minLength: 1, maxLength: 8 },
  )
  .map((rows) =>
    rows.map((r, i) =>
      task({
        id: `id${i}`,
        title: `Title${i}Zq`,
        order: i,
        type: r.type,
        estHours: r.hours,
        doneHours: Math.min(r.done, r.hours),
        ...(r.provider ? { provider: r.provider } : {}),
        ...(r.withUrl ? { url: `https://example.com/t${i}` } : {}),
        lessons: r.lessons.map((l, j) => ({
          title: `Lesson${i}x${j}`,
          ...(l.withUrl ? { url: `https://example.com/t${i}/l${j}` } : {}),
          needsCheck: l.check,
        })),
        howToSteps: Array.from({ length: r.steps }, (_, k) => `Step${i}x${k}`),
        dependsOn: i > 0 && r.cert ? [`id${i - 1}`] : [],
        ...(r.anchorOffset !== undefined
          ? {
              isAnchor: true,
              anchorDate: `2026-11-${String(2 + r.anchorOffset).padStart(2, '0')}`,
              anchorStartTime: '10:00',
              estHours: 1,
              type: 'cert_exam' as const,
              isCertificate: true,
              certificateName: `Cert${i}Zq`,
            }
          : {}),
      }),
    ),
  );

const urlsIn = (value: unknown): string[] =>
  JSON.stringify(value).match(/https:\/\/[^"\s]+/g) ?? [];

describe('buildBriefing properties', () => {
  const run = (tasks: Task[], date: string) => {
    const result = schedule({ tasks, pattern: basePattern, today: '2026-11-01' });
    const input: BriefingInput = {
      date,
      blocks: result.blocks.filter((b) => b.date === date),
      earlierBlocks: result.blocks.filter((b) => b.date < date),
      tasks,
      pattern: basePattern,
      warnings: result.warnings,
      finishDate: result.finishDate,
    };
    return { input, briefing: buildBriefing(input) };
  };
  const dateArb = fc.constantFrom(
    '2026-11-01',
    '2026-11-02',
    '2026-11-03',
    '2026-11-06',
    '2026-11-08',
  );

  it('is deterministic and does not change its input', () => {
    fc.assert(
      fc.property(planArb, dateArb, (tasks, date) => {
        const { input, briefing } = run(tasks, date);
        const before = JSON.stringify(input);
        expect(JSON.stringify(buildBriefing(input))).toBe(JSON.stringify(briefing));
        expect(JSON.stringify(input)).toBe(before);
        expect(BriefingSchema.safeParse(briefing).success).toBe(true);
      }),
      { numRuns: 150 },
    );
  });

  it('contains only task data that exists in the input and never invents a link', () => {
    fc.assert(
      fc.property(planArb, dateArb, (tasks, date) => {
        const { input, briefing } = run(tasks, date);
        const allowed = new Set<string>();
        for (const t of tasks) {
          if (t.url) allowed.add(t.url);
          for (const l of t.lessons) if (l.url) allowed.add(l.url);
        }
        for (const url of urlsIn(briefing)) expect(allowed.has(url)).toBe(true);
        for (const t of briefing.tasks) {
          const src = tasks.find((x) => x.id === t.taskId)!;
          expect(t.title).toBe(src.title);
          expect(t.type).toBe(src.type);
          expect(t.lessons.map((l) => l.title)).toEqual(src.lessons.map((l) => l.title));
          expect(t.howToSteps).toEqual(src.howToSteps);
          expect(t.provider).toBe(src.provider);
          expect(t.url).toBe(src.url);
        }
        void input;
      }),
      { numRuns: 150 },
    );
  });

  it('lists exactly the tasks scheduled today and mentions no other task title', () => {
    fc.assert(
      fc.property(planArb, dateArb, (tasks, date) => {
        const { input, briefing } = run(tasks, date);
        const scheduled = new Set(input.blocks.map((b) => b.taskId));
        expect(new Set(briefing.tasks.map((t) => t.taskId))).toEqual(scheduled);
        expect(new Set(briefing.suggestedOrder.map((o) => o.taskId))).toEqual(scheduled);
        // Titles look like TitleNZq. Only today's tasks (and upcoming anchors, which may be named
        // by title or certificate name) can appear in the overview.
        const anchors = new Set(
          tasks.filter((t) => t.isAnchor && t.anchorDate! >= date).map((t) => t.id),
        );
        for (const t of tasks) {
          const named =
            briefing.overview.includes(t.title) ||
            briefing.overview.includes(`Cert${t.id.slice(2)}Zq`);
          if (named) expect(scheduled.has(t.id) || anchors.has(t.id)).toBe(true);
        }
        const planned = briefing.tasks.reduce((s, t) => s + t.plannedMinutes, 0);
        expect(planned).toBe(input.blocks.reduce((s, b) => s + b.minutes, 0));
      }),
      { numRuns: 150 },
    );
  });

  it('handles days with no blocks and plans without an anchor', () => {
    fc.assert(
      fc.property(planArb, (tasks) => {
        const noAnchor = tasks.map((t) => ({ ...t, isAnchor: false, anchorDate: undefined }));
        const b = buildBriefing({
          date: '2026-11-06', // Friday: not a study day
          blocks: [],
          tasks: noAnchor,
          pattern: basePattern,
        });
        expect(b.tasks).toEqual([]);
        expect(b.suggestedOrder).toEqual([]);
        expect(b.overview).toMatch(/^Today is a rest day with nothing scheduled\. /);
        expect(b.source).toBe('template');
      }),
      { numRuns: 50 },
    );
  });
});
