/**
 * The "No AI" path: a rubric self-check built from the task's own steps, scored by a rule.
 * Pure and deterministic. Nothing here marks a task done; the user does that.
 */
import type { Feedback } from './feedback';

/**
 * Editorial, generic self-check steps for a practice whose plan task has no steps of its own.
 * These are our own wording, not content from any exam or course.
 */
export const GENERIC_RUBRIC_STEPS: readonly string[] = [
  'I finished the whole task within the planned time',
  'I checked my work once before calling it done',
  'I can explain my choices in plain words',
  'I wrote down one thing to do better next time',
];

/** `round(10 * checked / total, 1)`; 0 when there are no steps. */
export function scoreRubric(steps: readonly string[], checked: readonly boolean[]): number {
  if (steps.length === 0) return 0;
  const done = steps.filter((_, i) => checked[i] === true).length;
  return Math.round((10 * done * 10) / steps.length) / 10;
}

function listSteps(steps: readonly string[]): string {
  return steps.join('; ');
}

/**
 * Feedback for a finished self-check, built from templates. `next_focus` is the first
 * unchecked step. Null when there are no steps (nothing to score).
 */
export function rubricFeedback(
  steps: readonly string[],
  checked: readonly boolean[],
): Feedback | null {
  if (steps.length === 0) return null;
  const done = steps.filter((_, i) => checked[i] === true);
  const open = steps.filter((_, i) => checked[i] !== true);
  return {
    score: scoreRubric(steps, checked),
    strengths:
      done.length > 0
        ? `Self-check: you completed ${done.length} of ${steps.length} steps (${listSteps(done)}).`
        : `Self-check: none of the ${steps.length} steps were ticked off yet.`,
    improve:
      open.length > 0
        ? `Still open: ${listSteps(open)}.`
        : 'Nothing left open on the self-check. Try a harder version next time.',
    next_focus: open[0] ?? 'Repeat this practice with a harder version.',
  };
}

/** Turns a user-entered score (for example 34 out of 40 on a timed test) into 0 to 10. */
export function normalizeEnteredScore(score: number, max: number): number | null {
  if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0 || score < 0) return null;
  return Math.round(Math.min(10, (score * 10) / max) * 10) / 10;
}

export interface StarCheck {
  situation: boolean;
  task: boolean;
  action: boolean;
  result: boolean;
}

/**
 * A rough hint on whether an answer has the four STAR parts (headings, or common cue words).
 * A hint only: it is never turned into a score.
 */
export function detectStar(answer: string): StarCheck {
  const has = (re: RegExp): boolean => re.test(answer);
  return {
    situation: has(/\b(situation|context|background|at the time)\b/i),
    task: has(/\b(task|goal|objective|my role|responsib\w*)\b/i),
    action: has(/\b(action|i (did|built|wrote|decided|led|created|fixed|asked|proposed))\b/i),
    result: has(/\b(result|outcome|impact|as a result|in the end|resulted)\b/i),
  };
}
