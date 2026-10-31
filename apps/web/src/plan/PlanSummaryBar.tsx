import { Link, Outlet } from 'react-router';
import type { PlanSummary } from '../api/client';
import { useProgress, useSchedule, useTasks } from '../api/hooks';
import { AlertIcon } from '../components/icons';
import { linkClass } from '../components/ui';
import { formatDate, formatHours, percent } from '../lib/format';
import { anchorRiskHeadline } from '../lib/warnings';
import { useActivePlan } from './context';

function Bar({ plan }: { plan: PlanSummary }) {
  const progress = useProgress(plan.id);
  const schedule = useSchedule(plan.id);
  const tasks = useTasks(plan.id);

  const titleOf = (id: string) => tasks.data?.tasks.find((t) => t.id === id)?.title ?? id;
  const atRisk = (schedule.data?.warnings ?? []).filter((w) => w.kind === 'anchor_at_risk');
  const totalCertificates = (tasks.data?.tasks ?? []).filter((t) => t.isCertificate).length;
  const done = progress.data?.hours.done ?? 0;
  const planned = progress.data?.hours.planned ?? 0;
  const pct = percent(done, planned);

  return (
    <section
      aria-label="Plan summary"
      className="sticky top-0 z-10 -mx-4 space-y-2 border-b border-border bg-bg px-4 py-2 md:-mx-8 md:px-8"
    >
      {atRisk.map((warning, index) => (
        <div
          key={`${warning.taskId as string}-${index}`}
          role="group"
          aria-label="Exam at risk"
          className="flex items-start gap-2 rounded-sm border-2 border-warn bg-warn-soft px-3 py-1.5"
        >
          <span className="text-warn">
            <AlertIcon />
          </span>
          <p className="min-w-0 grow text-sm">
            <strong className="text-warn">Exam at risk:</strong>{' '}
            {anchorRiskHeadline(warning, titleOf)}.{' '}
            <Link to="/plan" className={linkClass}>
              See the plan
            </Link>
          </p>
        </div>
      ))}
      {progress.data ? (
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div
              role="progressbar"
              aria-label="Plan progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-valuetext={`${pct} percent, ${formatHours(done)} of ${formatHours(planned)} done`}
              className="h-3 grow overflow-hidden rounded-full bg-surface-2"
            >
              <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
            <span className="font-bold tabular-nums">{pct}%</span>
          </div>
          <p className="flex flex-wrap gap-x-4 gap-y-0 text-sm text-muted tabular-nums">
            <span>
              {formatHours(done)} done of {formatHours(planned)} planned
            </span>
            {totalCertificates > 0 ? (
              <span>
                Certificates {progress.data.certificatesEarned} of {totalCertificates}
              </span>
            ) : null}
            {schedule.data?.finishDate ? (
              <span>Finish {formatDate(schedule.data.finishDate, 'short')}</span>
            ) : null}
          </p>
        </div>
      ) : progress.isError ? (
        <p className="text-muted">Progress summary is not available right now.</p>
      ) : (
        <p className="text-muted">Loading progress…</p>
      )}
    </section>
  );
}

/**
 * The pages of the open plan (Today, Week, Plan, a task) share this strip on top: overall
 * progress, certificates earned and an exam-at-risk warning that stays in view. It reads the same
 * queries as the pages, so it costs no extra requests.
 */
export function PlanLayout() {
  const { plan } = useActivePlan();
  return (
    <>
      {plan ? <Bar plan={plan} /> : null}
      <div className="pt-6">
        <Outlet />
      </div>
    </>
  );
}
