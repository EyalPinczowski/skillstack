import { chartSummary, type WeekDay } from '../../lib/day-hours';
import { formatDate, formatHours, weekdayShort } from '../../lib/format';

const CHART_HEIGHT_PX = 160;

/** A round upper limit for the axis: 1, 2, 4, 6, 8 ... so the gridline labels stay readable. */
function axisMax(days: WeekDay[]): number {
  const top = Math.max(1, ...days.flatMap((d) => [d.planned, d.completed]));
  return top <= 2 ? Math.ceil(top) : Math.ceil(top / 2) * 2;
}

function Bar({
  hours,
  pct,
  title,
  barClass,
  labelClass,
}: {
  hours: number;
  pct: string;
  title: string;
  barClass: string;
  labelClass: string;
}) {
  return (
    <div className="relative h-full w-1/2" title={title}>
      <span
        className={`absolute inset-x-0 text-center text-xs tabular-nums ${labelClass}`}
        style={{ bottom: `calc(${pct} + 2px)` }}
      >
        {Number(hours.toFixed(1))}
      </span>
      <div className={`absolute inset-x-0 bottom-0 ${barClass}`} style={{ height: pct }} />
    </div>
  );
}

/**
 * Planned against actual hours for each day of the week, as plain bars. Planned is an outlined
 * bar, actual a filled one, so the two differ by shape and by the number printed above them, not
 * by colour. The hour values are text, the axis is labelled, and the same data is in the table
 * under the chart. No gradients; the bar height is the only encoding.
 */
export function WeekChart({ days }: { days: WeekDay[] }) {
  const max = axisMax(days);
  const height = (hours: number) => `${Math.max(hours > 0 ? 2 : 0, (hours / max) * 100)}%`;
  return (
    <figure className="space-y-3">
      <figcaption className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <span className="font-bold">Hours per day</span>
        <span className="inline-flex items-center gap-2 text-muted">
          <span
            aria-hidden="true"
            className="inline-block size-4 rounded-sm border-2 border-muted bg-surface-2"
          />
          Planned
        </span>
        <span className="inline-flex items-center gap-2 text-muted">
          <span aria-hidden="true" className="inline-block size-4 rounded-sm bg-accent" />
          Actual
        </span>
      </figcaption>
      <div role="img" aria-label={chartSummary(days)} className="flex gap-2">
        <div
          aria-hidden="true"
          className="flex flex-col justify-between pb-7 pt-5 text-right text-sm tabular-nums text-muted"
          style={{ height: CHART_HEIGHT_PX + 48 }}
        >
          <span>{max} h</span>
          <span>{max / 2} h</span>
          <span>0 h</span>
        </div>
        <div className="grid min-w-0 grow grid-cols-7 gap-1.5 pt-5 sm:gap-3" aria-hidden="true">
          {days.map((d) => (
            <div key={d.date} className="flex min-w-0 flex-col items-center gap-1">
              <div
                className="relative flex w-full justify-center gap-0.5 border-b border-border"
                style={{ height: CHART_HEIGHT_PX }}
              >
                <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border" />
                <Bar
                  hours={d.planned}
                  pct={height(d.planned)}
                  title={`Planned ${formatHours(d.planned)}`}
                  barClass="rounded-t-sm border-2 border-b-0 border-muted bg-surface-2"
                  labelClass="text-muted"
                />
                <Bar
                  hours={d.completed}
                  pct={height(d.completed)}
                  title={`Actual ${formatHours(d.completed)}`}
                  barClass="rounded-t-sm bg-accent"
                  labelClass="font-bold"
                />
              </div>
              <span className={`text-sm ${d.isToday ? 'font-bold' : 'text-muted'}`}>
                {weekdayShort(d.date)}
                {d.isToday ? <span className="sr-only"> (today)</span> : null}
              </span>
              {d.isToday ? (
                <span aria-hidden="true" className="-mt-1 text-xs font-bold">
                  Today
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <details>
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-bold text-accent underline underline-offset-2">
          Show the numbers as a table
        </summary>
        <table className="mt-2 w-full border-collapse text-left tabular-nums">
          <caption className="sr-only">Planned and actual hours per day this week</caption>
          <thead>
            <tr>
              <th scope="col" className="border-b border-border py-2 pr-3">
                Day
              </th>
              <th scope="col" className="border-b border-border py-2 pr-3">
                Planned
              </th>
              <th scope="col" className="border-b border-border py-2">
                Actual
              </th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date}>
                <th scope="row" className="border-b border-border py-2 pr-3 font-normal">
                  {formatDate(d.date, 'short')}
                  {d.isToday ? ' (today)' : ''}
                </th>
                <td className="border-b border-border py-2 pr-3">{formatHours(d.planned)}</td>
                <td className="border-b border-border py-2">{formatHours(d.completed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
