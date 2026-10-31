import { useId, useState, type FormEvent } from 'react';
import type { TaskType } from '../../api/client';
import { useSubmitReview, type ReviewResult, type StoredReview } from '../../api/review-hooks';
import { TaskTypeChip } from '../../components/TaskChips';
import { CheckIcon } from '../../components/icons';
import { Button, ErrorText, TextAreaField, TextField } from '../../components/ui';
import { describeError } from '../../lib/messages';
import { TASK_TYPE_META } from '../../lib/task-types';
import {
  buildReviewInput,
  draftFromReview,
  emptyOutcome,
  NOTE_MAX,
  REASON_MAX,
  validateDraft,
  type DraftErrors,
  type OutcomeKind,
  type ReviewDraft,
  type ScaleName,
} from './review-draft';
import { ScaleGroup } from './ScaleGroup';

export interface ReviewRow {
  id: string;
  title: string;
  type?: TaskType;
}

const OUTCOMES: { value: OutcomeKind; label: string }[] = [
  { value: 'done', label: 'Done' },
  { value: 'partial', label: 'Partly done' },
  { value: 'not_done', label: 'Not done' },
];

const SCALES: {
  name: ScaleName;
  legend: string;
  hint: string;
  labels: readonly [string, string, string, string, string];
}[] = [
  {
    name: 'difficulty',
    legend: 'How hard was today’s content?',
    hint: '1 is very easy, 5 is very hard.',
    labels: ['Very easy', 'Easy', 'Medium', 'Hard', 'Very hard'],
  },
  {
    name: 'density',
    legend: 'How full was the day?',
    hint: '1 is too light, 5 is too much.',
    labels: ['Too light', 'A bit light', 'Just right', 'A bit much', 'Too much'],
  },
  {
    name: 'energy',
    legend: 'How was your energy and focus?',
    hint: '1 is very low, 5 is high.',
    labels: ['Very low', 'Low', 'OK', 'Good', 'High'],
  },
];

function OutcomeFieldset({
  row,
  value,
  error,
  onChange,
}: {
  row: ReviewRow;
  value: ReviewDraft['outcomes'][string] | undefined;
  error?: string;
  onChange: (next: NonNullable<ReviewDraft['outcomes'][string]>) => void;
}) {
  const name = useId();
  const current = value ?? emptyOutcome();
  return (
    <fieldset
      className={`space-y-3 rounded-md border border-l-4 border-border bg-surface p-4 ${row.type ? TASK_TYPE_META[row.type].strip : ''}`}
    >
      <legend className="sr-only">{row.title}</legend>
      <div className="flex flex-wrap items-center gap-2">
        {row.type ? <TaskTypeChip type={row.type} /> : null}
      </div>
      <p className="text-lg font-bold" aria-hidden="true">
        {row.title}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {OUTCOMES.map((option) => {
          const selected = current.outcome === option.value;
          return (
            <label key={option.value} className="relative block">
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange({ ...current, outcome: option.value })}
                aria-label={`${option.label}: ${row.title}`}
                className="peer sr-only"
              />
              <span
                className={`flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-sm border-2 px-1 py-2 text-center font-bold peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
                  selected
                    ? 'border-accent bg-accent text-on-accent'
                    : 'border-border bg-surface text-text hover:border-accent'
                }`}
              >
                {selected ? <CheckIcon /> : null}
                {option.label}
              </span>
            </label>
          );
        })}
      </div>
      {current.outcome === 'partial' ? (
        <TextField
          label={`Hours spent on ${row.title}`}
          type="number"
          inputMode="decimal"
          step="0.25"
          min="0"
          max="24"
          value={current.hours}
          onChange={(event) => onChange({ ...current, hours: event.target.value })}
          error={error}
          className="max-w-40"
        />
      ) : null}
      {current.outcome === 'partial' || current.outcome === 'not_done' ? (
        <TextField
          label={`Reason (optional) for ${row.title}`}
          value={current.reason}
          maxLength={REASON_MAX}
          onChange={(event) => onChange({ ...current, reason: event.target.value })}
        />
      ) : null}
    </fieldset>
  );
}

/**
 * The end-of-day form (spec 3.4). It only collects answers and sends them with the Save button. It
 * never logs hours and never marks a task done: the result shows what is left for the person to do.
 */
export function ReviewForm({
  planId,
  date,
  rows,
  initial,
  onSaved,
}: {
  planId: string;
  date: string;
  rows: ReviewRow[];
  initial: StoredReview | null;
  onSaved: (result: ReviewResult) => void;
}) {
  const submit = useSubmitReview(planId, date);
  const [draft, setDraft] = useState<ReviewDraft>(() => draftFromReview(initial));
  const [errors, setErrors] = useState<DraftErrors | null>(null);
  const taskIds = rows.map((r) => r.id);
  const noteId = useId();

  function patch(next: Partial<ReviewDraft>) {
    setDraft((d) => ({ ...d, ...next }));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const found = validateDraft(draft, taskIds);
    setErrors(found);
    if (found.any) return;
    submit.mutate(buildReviewInput(date, draft, taskIds), { onSuccess: onSaved });
  }

  const saving = submit.isPending;
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6" aria-label="End-of-day review">
      <section aria-labelledby="outcomes-heading" className="space-y-3">
        <h2 id="outcomes-heading">What got done</h2>
        {rows.length === 0 ? (
          <p className="text-muted">No tasks were planned for this day.</p>
        ) : (
          <>
            <p className="text-muted">
              Tasks you leave unanswered are not recorded. Saving the review does not log hours or
              mark anything as done.
            </p>
            <div className="space-y-3">
              {rows.map((row) => (
                <OutcomeFieldset
                  key={row.id}
                  row={row}
                  value={draft.outcomes[row.id]}
                  error={errors?.hours[row.id]}
                  onChange={(next) => patch({ outcomes: { ...draft.outcomes, [row.id]: next } })}
                />
              ))}
            </div>
          </>
        )}
      </section>

      <section aria-labelledby="feel-heading" className="space-y-5">
        <h2 id="feel-heading">How did it feel?</h2>
        {SCALES.map((scale) => (
          <ScaleGroup
            key={scale.name}
            legend={scale.legend}
            hint={scale.hint}
            labels={scale.labels}
            value={draft[scale.name]}
            onChange={(value) => patch({ [scale.name]: value })}
            error={errors?.scales[scale.name]}
          />
        ))}
        <div className="space-y-1">
          <TextAreaField
            label="Note (optional)"
            rows={4}
            maxLength={NOTE_MAX}
            value={draft.note}
            aria-describedby={`${noteId}-count`}
            onChange={(event) => patch({ note: event.target.value })}
          />
          <p id={`${noteId}-count`} className="text-sm text-muted tabular-nums">
            {draft.note.length} / {NOTE_MAX} characters
          </p>
        </div>
      </section>

      <div className="space-y-2">
        {errors?.any ? (
          <ErrorText>Some answers need attention. Check the marked fields.</ErrorText>
        ) : null}
        {submit.isError ? (
          <ErrorText>{describeError(submit.error, 'The review could not be saved.')}</ErrorText>
        ) : null}
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Update review' : 'Save review'}
        </Button>
      </div>
    </form>
  );
}
