import type { DayHours } from '../../lib/day-hours';
import { formatHours, percent } from '../../lib/format';

/** Planned, completed and remaining hours of one day, in words and a bar. */
export function DayHoursSummary({ hours, label }: { hours: DayHours; label: string }) {
  const pct = percent(hours.completed, hours.planned);
  return (
    <section aria-label={label} className="space-y-2">
      <dl className="grid grid-cols-3 gap-3">
        <div>
          <dt className="text-muted">Planned</dt>
          <dd className="text-h2 font-bold tabular-nums">{formatHours(hours.planned)}</dd>
        </div>
        <div>
          <dt className="text-muted">Completed</dt>
          <dd className="text-h2 font-bold tabular-nums">{formatHours(hours.completed)}</dd>
        </div>
        <div>
          <dt className="text-muted">Remaining</dt>
          <dd className="text-h2 font-bold tabular-nums">{formatHours(hours.remaining)}</dd>
        </div>
      </dl>
      <div
        role="progressbar"
        aria-label={`${label} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${formatHours(hours.completed)} of ${formatHours(hours.planned)} done`}
        className="h-3 overflow-hidden rounded-full bg-surface-2"
      >
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </section>
  );
}
