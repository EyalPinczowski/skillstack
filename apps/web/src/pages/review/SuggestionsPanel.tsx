import { useId, useRef, useState } from 'react';
import { isApiError } from '../../api/errors';
import {
  useAcceptSuggestion,
  usePreviewSuggestion,
  useRejectSuggestion,
  useSuggestions,
  type Suggestion,
  type SuggestionPreview,
} from '../../api/review-hooks';
import { QueryView } from '../../components/QueryView';
import { AlertIcon, CheckIcon } from '../../components/icons';
import { Button, ErrorText } from '../../components/ui';
import { formatDate } from '../../lib/format';
import { describeError } from '../../lib/messages';
import { describeChange } from './describe-change';

const STALE =
  'Your plan or reviews changed since these suggestions were loaded, so nothing was applied. The list has been refreshed: look at it again.';

interface Decided {
  id: string;
  title: string;
  text: string;
}

const finishText = (date: string | null) => (date ? formatDate(date) : 'no finish date');

function SuggestionCard({
  planId,
  suggestion,
  titleOf,
  onDecided,
  onStale,
}: {
  planId: string;
  suggestion: Suggestion;
  titleOf: (taskId: string) => string;
  onDecided: (decided: Decided) => void;
  onStale: () => void;
}) {
  const optionName = useId();
  const preview = usePreviewSuggestion(planId);
  const accept = useAcceptSuggestion(planId);
  const reject = useRejectSuggestion(planId);
  const [option, setOption] = useState(0);
  // The preview belongs to one option; changing the option throws it away.
  const [shown, setShown] = useState<{ option: number; data: SuggestionPreview } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Blocks a second click before React has re-rendered the disabled button.
  const busy = useRef(false);

  const options = [suggestion.proposedChange, ...suggestion.alternatives];
  const working = preview.isPending || accept.isPending || reject.isPending;
  const previewed = shown?.option === option ? shown.data : null;

  function fail(err: unknown, fallback: string) {
    if (isApiError(err) && err.status === 409) {
      // The evidence changed: the hook refetches the list. Say so, and drop the old preview.
      setError(null);
      setShown(null);
      onStale();
    } else {
      setError(describeError(err, fallback));
    }
  }

  /** Runs one request at a time; a second click before the button is disabled is ignored. */
  function once(start: (done: () => void) => void) {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    start(() => {
      busy.current = false;
    });
  }

  function onPreview() {
    once((done) =>
      preview.mutate(
        { id: suggestion.id, option },
        {
          onSuccess: (data) => setShown({ option, data }),
          onError: (e) => fail(e, 'The preview could not be computed.'),
          onSettled: done,
        },
      ),
    );
  }

  function onAccept() {
    once((done) =>
      accept.mutate(
        { id: suggestion.id, option },
        {
          onSuccess: (result) =>
            onDecided({
              id: suggestion.id,
              title: suggestion.title,
              text: result.replayed
                ? 'This change was already applied earlier.'
                : (result.summary?.text ?? 'The change was applied.'),
            }),
          onError: (e) => fail(e, 'The change could not be applied.'),
          onSettled: done,
        },
      ),
    );
  }

  function onReject() {
    once((done) =>
      reject.mutate(
        { id: suggestion.id },
        {
          onSuccess: () =>
            onDecided({
              id: suggestion.id,
              title: suggestion.title,
              text: 'Rejected. It will not be offered again for the same evidence.',
            }),
          onError: (e) => fail(e, 'The suggestion could not be rejected.'),
          onSettled: done,
        },
      ),
    );
  }

  return (
    <li className="space-y-3 rounded-md border border-l-4 border-border border-l-accent bg-surface p-4">
      <article aria-labelledby={`${optionName}-title`} className="space-y-3">
        <h3 id={`${optionName}-title`} className="text-lg font-bold">
          {suggestion.title}
        </h3>
        <p>{suggestion.explanation}</p>

        <div className="space-y-1">
          <p className="font-bold">Why we suggest this</p>
          <ul className="list-disc space-y-0.5 pl-6 text-muted">
            {suggestion.evidence.reviewDates.length > 0 ? (
              <li>
                Based on your reviews of{' '}
                {suggestion.evidence.reviewDates.map((d) => formatDate(d, 'short')).join(', ')}
              </li>
            ) : null}
            {suggestion.evidence.taskIds.length > 0 ? (
              <li>Based on {suggestion.evidence.taskIds.map(titleOf).join(', ')}</li>
            ) : null}
          </ul>
        </div>

        {options.length > 1 ? (
          <fieldset className="space-y-2">
            <legend className="font-bold">Choose an option</legend>
            {options.map((change, index) => (
              <label
                key={index}
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-sm border border-border p-2 has-[:checked]:border-2 has-[:checked]:border-accent has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-accent"
              >
                <input
                  type="radio"
                  name={optionName}
                  checked={option === index}
                  disabled={working}
                  onChange={() => {
                    setOption(index);
                    setError(null);
                  }}
                  className="mt-1 size-5 shrink-0 accent-[var(--accent)]"
                />
                <span>
                  <strong>{index === 0 ? 'Recommended: ' : `Alternative ${index}: `}</strong>
                  {describeChange(change, titleOf)}
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p>
            <strong>Proposed change: </strong>
            {describeChange(suggestion.proposedChange, titleOf)}
          </p>
        )}

        {previewed ? (
          <div role="status" className="space-y-1 rounded-sm border border-border bg-surface-2 p-3">
            <p className="font-bold">Preview (nothing is applied yet)</p>
            <p>{previewed.summary.text}</p>
            <p className="text-muted">
              Plan finish now: {finishText(previewed.currentFinishDate)}. With this change:{' '}
              {finishText(previewed.proposedFinishDate)}.
            </p>
            {previewed.summary.newAnchorRisks.length > 0 ? (
              <p className="flex items-start gap-2 font-bold text-warn">
                <AlertIcon />
                <span>
                  Puts these fixed dates at risk:{' '}
                  {previewed.summary.newAnchorRisks.map(titleOf).join(', ')}
                </span>
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? <ErrorText>{error}</ErrorText> : null}

        <div className="flex flex-wrap gap-3">
          <Button disabled={working} onClick={onPreview}>
            {preview.isPending ? 'Computing…' : 'Preview'}
            <span className="sr-only">: {suggestion.title}</span>
          </Button>
          <Button variant="primary" disabled={working || !previewed} onClick={onAccept}>
            {accept.isPending ? 'Applying…' : 'Accept'}
            <span className="sr-only">: {suggestion.title}</span>
          </Button>
          <Button disabled={working} onClick={onReject}>
            Reject<span className="sr-only">: {suggestion.title}</span>
          </Button>
        </div>
        {!previewed ? (
          <p className="text-sm text-muted">Preview the change first to see what it would do.</p>
        ) : null}
      </article>
    </li>
  );
}

/**
 * The open adjustment suggestions (spec 3.4). Plan changes are only suggestions: a preview computes
 * the effect, and nothing is applied until the person presses Accept.
 */
export function SuggestionsPanel({
  planId,
  titleOf,
}: {
  planId: string;
  titleOf: (taskId: string) => string;
}) {
  const query = useSuggestions(planId);
  const [decided, setDecided] = useState<Decided[]>([]);
  const [stale, setStale] = useState(false);

  return (
    <section aria-labelledby="suggestions-heading" className="space-y-3">
      <h2 id="suggestions-heading">Suggestions for your plan</h2>
      <div role="status" aria-live="polite">
        {stale ? (
          <p className="flex items-start gap-2 font-bold text-warn">
            <AlertIcon />
            <span>{STALE}</span>
          </p>
        ) : null}
        {decided.map((d) => (
          <p key={d.id} className="flex items-start gap-2 font-bold text-ok">
            <CheckIcon />
            <span>
              {d.title}: {d.text}
            </span>
          </p>
        ))}
      </div>
      <QueryView query={query} label="Loading suggestions…">
        {(data) => {
          const open = data.suggestions.filter((s) => !decided.some((d) => d.id === s.id));
          return open.length === 0 ? (
            <p className="text-muted">
              No suggestions right now. They appear when your reviews and logged hours show a
              pattern.
            </p>
          ) : (
            <ul className="space-y-3">
              {open.map((suggestion) => (
                <SuggestionCard
                  key={suggestion.id}
                  planId={planId}
                  suggestion={suggestion}
                  titleOf={titleOf}
                  onStale={() => setStale(true)}
                  onDecided={(d) => {
                    setStale(false);
                    setDecided((list) => [...list, d]);
                  }}
                />
              ))}
            </ul>
          );
        }}
      </QueryView>
    </section>
  );
}
