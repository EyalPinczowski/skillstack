import { useId } from 'react';
import { CheckIcon } from '../../components/icons';
import { ErrorText } from '../../components/ui';

/**
 * A 1-5 scale as a radio group with big touch targets. The chosen option has a heavier border and a
 * check mark as well as the filled background, so it is not shown by colour alone. The inputs are
 * real radios, so arrow keys move the choice and a screen reader reads "3 of 5".
 */
export function ScaleGroup({
  legend,
  hint,
  labels,
  value,
  onChange,
  error,
}: {
  legend: string;
  hint?: string;
  /** Five labels, for 1 to 5. */
  labels: readonly [string, string, string, string, string];
  value: number | null;
  onChange: (value: number) => void;
  error?: string | null;
}) {
  const name = useId();
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  return (
    <fieldset
      className="space-y-2"
      aria-describedby={
        [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
      }
    >
      <legend className="font-bold">{legend}</legend>
      {hint ? (
        <p id={hintId} className="text-muted">
          {hint}
        </p>
      ) : null}
      <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
        {labels.map((label, index) => {
          const n = index + 1;
          const selected = value === n;
          return (
            <label key={n} className="relative block">
              <input
                type="radio"
                name={name}
                value={n}
                aria-label={`${n} of 5, ${label}`}
                checked={selected}
                onChange={() => onChange(n)}
                className="peer sr-only"
              />
              <span
                className={`flex min-h-16 min-w-11 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-sm border-2 px-0.5 py-1 text-center peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
                  selected
                    ? 'border-accent bg-accent text-on-accent'
                    : 'border-border bg-surface text-text hover:border-accent'
                }`}
              >
                <span className="flex items-center gap-0.5 text-lg font-bold leading-none">
                  {n}
                  {selected ? <CheckIcon /> : null}
                </span>
                <span className="text-xs leading-tight sm:text-sm">{label}</span>
              </span>
            </label>
          );
        })}
      </div>
      {error ? <ErrorText id={errorId}>{error}</ErrorText> : null}
    </fieldset>
  );
}
