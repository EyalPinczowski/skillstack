import type { Briefing, DayState } from '../api/briefing-hooks';
import type { StoredReview, Suggestion } from '../api/review-hooks';
import { apiError, json } from './helpers';
import { NOW, PLAN_ID, planRoutes } from './plan-fixtures';

export const DATE = '2026-11-10';
export const BASE = `/api/v1/plans/${PLAN_ID}`;

export const briefingBody = (overrides: Partial<Briefing> = {}): Briefing => ({
  date: DATE,
  source: 'template',
  overview:
    'Today is 4 hours of study: 1 course and 1 practice. This work leads toward the SQL exam on 2026-11-19, in 7 study days.',
  tasks: [
    {
      taskId: 'sql1',
      title: 'Intro to SQL',
      type: 'course',
      provider: 'Kaggle',
      url: 'https://example.test/sql',
      plannedMinutes: 150,
      start: '09:00',
      end: '12:30',
      blocks: [
        { start: '09:00', end: '10:30', minutes: 90 },
        { start: '11:30', end: '12:30', minutes: 60 },
      ],
      what: 'Study "Intro to SQL" on Kaggle: 2 hours 30 minutes today.',
      lessons: [
        {
          title: 'Select basics',
          url: 'https://example.test/sql/1',
          estMinutes: 30,
          summary: 'Filtering and sorting rows.',
          needsCheck: true,
        },
        { title: 'Joins', estMinutes: 45, needsCheck: false },
      ],
      howToSteps: ['Open the course', 'Finish the next two lessons'],
      promptTemplate: null,
      successCriteria: null,
      carriedOver: true,
    },
    {
      taskId: 'practice1',
      title: 'Mock interview',
      type: 'practice',
      plannedMinutes: 90,
      start: '14:00',
      end: '15:30',
      blocks: [{ start: '14:00', end: '15:30', minutes: 90 }],
      what: 'Practice "Mock interview": 1 hour 30 minutes today.',
      lessons: [],
      howToSteps: ['Set a timer', 'Answer out loud'],
      promptTemplate: 'Act as an interviewer.\nAsk me three SQL questions.',
      successCriteria: 'You answer all three without notes.',
      carriedOver: false,
    },
  ],
  suggestedOrder: [
    { taskId: 'sql1', start: '09:00', end: '10:30' },
    { taskId: 'practice1', start: '14:00', end: '15:30' },
  ],
  ...overrides,
});

export const dayState = (overrides: Partial<DayState> = {}): DayState => ({
  date: DATE,
  status: 'not_started',
  startedAt: null,
  endedAt: null,
  frozen: null,
  ...overrides,
});

export const storedReview = (overrides: Partial<StoredReview> = {}): StoredReview => ({
  date: DATE,
  difficulty: 4,
  density: 5,
  energy: 2,
  note: 'Tiring day',
  outcomes: [
    { taskId: 'sql1', outcome: 'partial', hours: 1.5, reason: 'Ran out of time' },
    { taskId: 'practice1', outcome: 'done' },
  ],
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

export const suggestion = (overrides: Partial<Suggestion> = {}): Suggestion => ({
  id: 'sg_1',
  rule: 'density_too_high',
  key: 'k1',
  title: 'Reduce your daily study time',
  explanation: 'You marked two days in a row as too much.',
  proposedChange: {
    kind: 'capacityDelta',
    scope: { type: 'weekdays', weekdays: [1, 2] },
    hours: -1,
  },
  alternatives: [
    {
      kind: 'capacityDelta',
      scope: { type: 'dateRange', from: '2026-11-11', to: '2026-11-13' },
      hours: -1,
    },
  ],
  evidence: { reviewDates: ['2026-11-09', '2026-11-10'], taskIds: [] },
  ...overrides,
});

export const previewBody = (text: string, option = 0) => ({
  suggestionId: 'sg_1',
  option,
  change: suggestion().proposedChange,
  summary: {
    movedTaskIds: ['sql1'],
    finishBefore: '2026-11-20',
    finishAfter: '2026-11-23',
    finishChanged: true,
    finishShiftStudyDays: 1,
    newAnchorRisks: [],
    text,
  },
  currentFinishDate: '2026-11-20',
  proposedFinishDate: '2026-11-23',
});

export const decision = (text: string, replayed = false) => ({
  adjustment: {
    suggestionId: 'sg_1',
    rule: 'density_too_high' as const,
    status: 'accepted' as const,
    option: 0,
    decidedAt: NOW,
  },
  summary: {
    movedTaskIds: ['sql1'],
    finishBefore: '2026-11-20',
    finishAfter: '2026-11-23',
    finishChanged: true,
    finishShiftStudyDays: 1,
    newAnchorRisks: [],
    text,
  },
  replayed,
});

/** Plan routes plus the day, review and suggestion routes with quiet defaults. */
export function dayRoutes(
  extra: Record<string, (request: Request) => Response | Promise<Response>> = {},
) {
  return planRoutes({
    [`GET ${BASE}/days/${DATE}/briefing`]: () => json(briefingBody()),
    [`GET ${BASE}/days/${DATE}`]: () => json(dayState()),
    [`POST ${BASE}/days/${DATE}/start`]: () => json(dayState({ status: 'started' }), 201),
    [`GET ${BASE}/days/${DATE}/review`]: () => apiError(404, 'not_found', 'No review.'),
    [`GET ${BASE}/reviews`]: () => json({ reviews: [] }),
    [`GET ${BASE}/suggestions`]: () => json({ today: DATE, suggestions: [] }),
    ...extra,
  });
}

/** The body of a recorded request, parsed. */
export async function bodyOf(request: Request): Promise<unknown> {
  return JSON.parse(await request.clone().text());
}
