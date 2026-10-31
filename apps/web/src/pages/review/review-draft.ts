import type { ReviewInput, StoredReview, TaskOutcome } from '../../api/review-hooks';

export type OutcomeKind = TaskOutcome['outcome'];
export type ScaleName = 'difficulty' | 'density' | 'energy';

export const NOTE_MAX = 2000;
export const REASON_MAX = 500;

export interface OutcomeDraft {
  outcome: OutcomeKind | null;
  /** Typed hours, kept as text so a half-typed number is not rewritten. */
  hours: string;
  reason: string;
}

export interface ReviewDraft {
  difficulty: number | null;
  density: number | null;
  energy: number | null;
  note: string;
  outcomes: Record<string, OutcomeDraft>;
}

export const emptyOutcome = (): OutcomeDraft => ({ outcome: null, hours: '', reason: '' });

/** The form's starting values: the stored review when there is one, otherwise empty. */
export function draftFromReview(review: StoredReview | null | undefined): ReviewDraft {
  const outcomes: Record<string, OutcomeDraft> = {};
  for (const o of review?.outcomes ?? []) {
    outcomes[o.taskId] = {
      outcome: o.outcome,
      hours: o.hours === undefined ? '' : String(o.hours),
      reason: o.reason ?? '',
    };
  }
  return {
    difficulty: review?.difficulty ?? null,
    density: review?.density ?? null,
    energy: review?.energy ?? null,
    note: review?.note ?? '',
    outcomes,
  };
}

/** Hours as typed ("1.5" or "1,5"), or null unless it is a number above 0 and at most 24. */
export function parseHours(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(value) && value > 0 && value <= 24 ? value : null;
}

export interface DraftErrors {
  scales: Partial<Record<ScaleName, string>>;
  hours: Record<string, string>;
  any: boolean;
}

export function validateDraft(draft: ReviewDraft, taskIds: string[]): DraftErrors {
  const scales: DraftErrors['scales'] = {};
  const names: Record<ScaleName, string> = {
    difficulty: 'how hard the content was',
    density: 'how full the day was',
    energy: 'your energy',
  };
  for (const name of ['difficulty', 'density', 'energy'] as const) {
    if (draft[name] === null) scales[name] = `Choose 1 to 5 for ${names[name]}.`;
  }
  const hours: DraftErrors['hours'] = {};
  for (const id of taskIds) {
    const o = draft.outcomes[id];
    if (o?.outcome === 'partial' && parseHours(o.hours) === null) {
      hours[id] = 'Enter the hours as a number above 0 and up to 24.';
    }
  }
  return {
    scales,
    hours,
    any: Object.keys(scales).length > 0 || Object.keys(hours).length > 0,
  };
}

/**
 * The request body. Tasks left unanswered are not sent. Hours go only with "partial", reasons only
 * with "partial" or "not done" and only when written. The draft must have passed `validateDraft`.
 */
export function buildReviewInput(date: string, draft: ReviewDraft, taskIds: string[]): ReviewInput {
  const outcomes: TaskOutcome[] = [];
  for (const taskId of taskIds) {
    const o = draft.outcomes[taskId];
    if (!o?.outcome) continue;
    const reason = o.reason.trim();
    const entry: TaskOutcome = { taskId, outcome: o.outcome };
    if (o.outcome === 'partial') entry.hours = parseHours(o.hours)!;
    if (o.outcome !== 'done' && reason) entry.reason = reason;
    outcomes.push(entry);
  }
  return {
    date,
    difficulty: draft.difficulty!,
    density: draft.density!,
    energy: draft.energy!,
    note: draft.note,
    outcomes,
  };
}
