import { describe, expect, it } from 'vitest';
import { FeedbackSchema } from './feedback';
import {
  GENERIC_RUBRIC_STEPS,
  detectStar,
  normalizeEnteredScore,
  rubricFeedback,
  scoreRubric,
} from './rubric';
import { trendsByKind } from './trends';

describe('scoreRubric', () => {
  it.each([
    [3, [true, true, true], 10],
    [3, [true, false, false], 3.3],
    [3, [true, true, false], 6.7],
    [4, [false, false, false, false], 0],
    [8, [true, false, false, false, false, false, false, false], 1.3],
  ])('%i steps %j gives %f', (n, checked, want) => {
    const steps = Array.from({ length: n }, (_, i) => `s${i}`);
    expect(scoreRubric(steps, checked)).toBe(want);
  });
  it('treats missing entries as unchecked and no steps as 0', () => {
    expect(scoreRubric(['a', 'b'], [true])).toBe(5);
    expect(scoreRubric([], [])).toBe(0);
  });
});

describe('rubricFeedback', () => {
  it('builds valid feedback with next_focus = first unchecked step', () => {
    const f = rubricFeedback(['Plan', 'Write', 'Review'], [true, false, false]);
    expect(f).not.toBeNull();
    expect(FeedbackSchema.safeParse(f).success).toBe(true);
    expect(f?.score).toBe(3.3);
    expect(f?.next_focus).toBe('Write');
    expect(f?.strengths).toContain('1 of 3');
    expect(f?.strengths).toContain('Plan');
    expect(f?.improve).toBe('Still open: Write; Review.');
  });
  it('handles all done and none done', () => {
    const all = rubricFeedback(['A', 'B'], [true, true]);
    expect(all?.score).toBe(10);
    expect(all?.improve).toContain('Nothing left open');
    expect(all?.next_focus).toBe('Repeat this practice with a harder version.');
    const none = rubricFeedback(['A', 'B'], []);
    expect(none?.score).toBe(0);
    expect(none?.strengths).toContain('none of the 2 steps');
    expect(FeedbackSchema.safeParse(none).success).toBe(true);
  });
  it('is null without steps, and the generic steps are usable', () => {
    expect(rubricFeedback([], [])).toBeNull();
    expect(GENERIC_RUBRIC_STEPS.length).toBeGreaterThan(2);
    expect(
      rubricFeedback(
        [...GENERIC_RUBRIC_STEPS],
        GENERIC_RUBRIC_STEPS.map(() => true),
      )?.score,
    ).toBe(10);
  });
});

describe('rubricFeedback is always schema-valid (S4)', () => {
  it('copes with 30 steps of 500 characters', () => {
    const steps = Array.from({ length: 30 }, (_, i) => `${i}`.padEnd(500, 'x'));
    const all = rubricFeedback(
      steps,
      steps.map(() => true),
    );
    expect(FeedbackSchema.safeParse(all).success).toBe(true);
    const none = rubricFeedback(steps, []);
    expect(FeedbackSchema.safeParse(none).success).toBe(true);
    expect(none?.next_focus.length).toBeLessThanOrEqual(500);
    expect(none?.improve.length).toBeLessThanOrEqual(2000);
    const some = rubricFeedback(
      steps,
      steps.map((_, i) => i < 10),
    );
    expect(FeedbackSchema.safeParse(some).success).toBe(true);
  });
  it('ignores blank steps and keeps ticks aligned with the original positions', () => {
    const f = rubricFeedback(['', 'Plan', '   ', 'Write'], [false, true, true, false]);
    expect(f?.score).toBe(5);
    expect(f?.next_focus).toBe('Write');
    expect(rubricFeedback(['', ' '], [true, true])).toBeNull();
    expect(scoreRubric(['', ' '], [true, true])).toBe(0);
    expect(FeedbackSchema.safeParse(rubricFeedback(['  a  '], [false])).success).toBe(true);
  });
});

describe('normalizeEnteredScore', () => {
  it('scales to 0 to 10', () => {
    expect(normalizeEnteredScore(34, 40)).toBe(8.5);
    expect(normalizeEnteredScore(5, 5)).toBe(10);
    expect(normalizeEnteredScore(0, 40)).toBe(0);
    expect(normalizeEnteredScore(50, 40)).toBe(10);
  });
  it('rejects nonsense', () => {
    expect(normalizeEnteredScore(-1, 10)).toBeNull();
    expect(normalizeEnteredScore(1, 0)).toBeNull();
    expect(normalizeEnteredScore(NaN, 10)).toBeNull();
    expect(normalizeEnteredScore(1, Infinity)).toBeNull();
  });
});

describe('detectStar', () => {
  it('finds headings and cue words', () => {
    expect(
      detectStar(
        'Situation: our report was late. Task: fix it. Action: I rebuilt it. Result: on time.',
      ),
    ).toEqual({ situation: true, task: true, action: true, result: true });
  });
  it('reports what is missing', () => {
    expect(detectStar('I did a thing and it went fine.')).toEqual({
      situation: false,
      task: false,
      action: true,
      result: false,
    });
    expect(detectStar('')).toEqual({ situation: false, task: false, action: false, result: false });
  });
});

describe('trendsByKind', () => {
  it('gives last, average and delta per kind, in time order', () => {
    const t = trendsByKind([
      { practiceKind: 'mock_interview', score: 8, at: '2026-11-03' },
      { practiceKind: 'mock_interview', score: 5, at: '2026-11-01' },
      { practiceKind: 'mock_interview', score: 6.5, at: '2026-11-02' },
      { practiceKind: 'home_assignment', score: 7, at: '2026-11-01' },
      { practiceKind: 'home_assignment', score: null, at: '2026-11-05' },
      { practiceKind: 'timed_test', score: null, at: '2026-11-05' },
    ]);
    expect(t).toEqual([
      { practiceKind: 'home_assignment', count: 1, last: 7, average: 7, delta: null, scores: [7] },
      {
        practiceKind: 'mock_interview',
        count: 3,
        last: 8,
        average: 6.5,
        delta: 1.5,
        scores: [5, 6.5, 8],
      },
    ]);
  });
  it('keeps input order for equal timestamps, shows a drop as negative, and handles empty input', () => {
    const t = trendsByKind([
      { practiceKind: 'a', score: 9, at: '2026-11-01' },
      { practiceKind: 'a', score: 4, at: '2026-11-01' },
    ]);
    expect(t[0]?.scores).toEqual([9, 4]);
    expect(t[0]?.delta).toBe(-5);
    expect(trendsByKind([])).toEqual([]);
  });
});
