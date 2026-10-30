import type { Progress } from '../../api/client';
import { useProgress } from '../../api/hooks';
import { QueryView } from '../../components/QueryView';
import { formatDate, formatHours, percent } from '../../lib/format';

function Summary({
  progress,
  finishDate,
  plannedCertificates,
}: {
  progress: Progress;
  finishDate: string | null;
  plannedCertificates: number;
}) {
  const { done, planned } = progress.hours;
  const pct = percent(done, planned);
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="progress-heading">Plan progress</h2>
        <span className="text-h1 font-bold tabular-nums">{pct}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="Plan progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pct} percent, ${formatHours(done)} of ${formatHours(planned)} done`}
        className="h-3.5 overflow-hidden rounded-full bg-surface-2"
      >
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-muted tabular-nums">
        {formatHours(done)} done of {formatHours(planned)} planned
      </p>
      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        <div>
          <dt className="text-muted">Finish</dt>
          <dd className="font-bold">
            {finishDate ? formatDate(finishDate, 'short') : 'Not scheduled'}
          </dd>
        </div>
        {plannedCertificates > 0 ? (
          <div>
            <dt className="text-muted">Certificates</dt>
            <dd className="font-bold tabular-nums">
              {progress.certificatesEarned} of {plannedCertificates}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-muted">Tasks done</dt>
          <dd className="font-bold tabular-nums">
            {progress.tasks.done} of {progress.tasks.total}
          </dd>
        </div>
      </dl>
    </>
  );
}

/** Overall progress from GET /progress, with the finish date taken from the schedule. */
export function ProgressSummary({
  planId,
  finishDate,
  plannedCertificates,
}: {
  planId: string;
  finishDate: string | null;
  plannedCertificates: number;
}) {
  const progress = useProgress(planId);
  return (
    <section
      aria-label="Plan progress"
      className="space-y-3 rounded-md border border-border bg-surface p-4"
    >
      <QueryView query={progress} label="Loading your progress…">
        {(data) => (
          <Summary
            progress={data}
            finishDate={finishDate}
            plannedCertificates={plannedCertificates}
          />
        )}
      </QueryView>
    </section>
  );
}
