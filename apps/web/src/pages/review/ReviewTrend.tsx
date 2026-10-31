import { addDays, diffDays } from '@skillstack/shared';
import { useId } from 'react';
import { useReviewHistory, type ReviewPoint } from '../../api/review-hooks';
import { QueryView } from '../../components/QueryView';
import { formatDate } from '../../lib/format';

/** Days shown in the trend, ending on the reviewed day. */
const WINDOW_DAYS = 30;

type SeriesKey = 'difficulty' | 'density' | 'energy';

/**
 * Each series differs in colour, line pattern and marker shape, so none of them depends on colour
 * alone. The colours are design tokens, so they follow light and dark mode.
 */
const SERIES: {
  key: SeriesKey;
  label: string;
  color: string;
  dash: string | undefined;
  shape: 'circle' | 'square' | 'triangle';
}[] = [
  {
    key: 'difficulty',
    label: 'Difficulty',
    color: 'var(--task-course)',
    dash: undefined,
    shape: 'circle',
  },
  { key: 'density', label: 'Density', color: 'var(--task-practice)', dash: '7 4', shape: 'square' },
  { key: 'energy', label: 'Energy', color: 'var(--task-cv)', dash: '2 4', shape: 'triangle' },
];

const W = 480;
const H = 270;
const M = { left: 52, right: 26, top: 14, bottom: 62 };
const plotW = W - M.left - M.right;
const plotH = H - M.top - M.bottom;

const yOf = (value: number) => M.top + plotH - ((value - 1) / 4) * plotH;

function Marker({
  shape,
  x,
  y,
  color,
}: {
  shape: 'circle' | 'square' | 'triangle';
  x: number;
  y: number;
  color: string;
}) {
  const common = { fill: 'var(--surface)', stroke: color, strokeWidth: 2.5 };
  if (shape === 'circle') return <circle cx={x} cy={y} r={4.5} {...common} />;
  if (shape === 'square') return <rect x={x - 4.5} y={y - 4.5} width={9} height={9} {...common} />;
  return <path d={`M${x} ${y - 6} L${x + 5.5} ${y + 4} L${x - 5.5} ${y + 4} Z`} {...common} />;
}

function Chart({ points, from, to }: { points: ReviewPoint[]; from: string; to: string }) {
  const titleId = useId();
  const span = Math.max(1, diffDays(from, to));
  const xOf = (date: string) => M.left + (diffDays(from, date) / span) * plotW;
  const ticks = [from, addDays(from, Math.round(span / 2)), to];
  const latest = points[points.length - 1];
  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-labelledby={titleId}
        className="h-auto w-full max-w-2xl"
      >
        <title id={titleId}>
          Difficulty, density and energy ratings from 1 to 5, per day, from{' '}
          {formatDate(from, 'short')} to {formatDate(to, 'short')}. The same data is in the table
          below.
        </title>
        {[1, 2, 3, 4, 5].map((v) => (
          <g key={v}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={yOf(v)}
              y2={yOf(v)}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text x={M.left - 8} y={yOf(v) + 5} textAnchor="end" fontSize={14} fill="var(--muted)">
              {v}
            </text>
          </g>
        ))}
        <line
          x1={M.left}
          x2={M.left}
          y1={M.top}
          y2={M.top + plotH}
          stroke="var(--muted)"
          strokeWidth={1.5}
        />
        <line
          x1={M.left}
          x2={W - M.right}
          y1={M.top + plotH}
          y2={M.top + plotH}
          stroke="var(--muted)"
          strokeWidth={1.5}
        />
        {ticks.map((date, i) => (
          <text
            key={date}
            x={xOf(date)}
            y={M.top + plotH + 20}
            textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}
            fontSize={14}
            fill="var(--muted)"
          >
            {formatDate(date, 'short').split(', ').slice(1).join(', ')}
          </text>
        ))}
        <text
          x={M.left + plotW / 2}
          y={H - 8}
          textAnchor="middle"
          fontSize={14}
          fill="var(--text)"
          fontWeight={700}
        >
          Date
        </text>
        <text
          transform={`translate(14 ${M.top + plotH / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize={14}
          fill="var(--text)"
          fontWeight={700}
        >
          Rating (1 to 5)
        </text>
        {SERIES.map((s) => (
          <g key={s.key}>
            {points.length > 1 ? (
              <polyline
                fill="none"
                stroke={s.color}
                strokeWidth={2.5}
                strokeDasharray={s.dash}
                strokeLinejoin="round"
                points={points.map((p) => `${xOf(p.date)},${yOf(p[s.key])}`).join(' ')}
              />
            ) : null}
            {points.map((p) => (
              <Marker
                key={p.date}
                shape={s.shape}
                x={xOf(p.date)}
                y={yOf(p[s.key])}
                color={s.color}
              />
            ))}
          </g>
        ))}
      </svg>

      <ul className="flex flex-wrap gap-x-5 gap-y-1" aria-label="Legend">
        {SERIES.map((s) => (
          <li key={s.key} className="flex min-h-8 items-center gap-2">
            <svg width="38" height="14" viewBox="0 0 38 14" aria-hidden="true" focusable="false">
              <line
                x1="0"
                x2="38"
                y1="7"
                y2="7"
                stroke={s.color}
                strokeWidth={2.5}
                strokeDasharray={s.dash}
              />
              <Marker shape={s.shape} x={19} y={7} color={s.color} />
            </svg>
            {s.label}
          </li>
        ))}
      </ul>

      {latest ? (
        <p className="text-muted">
          Latest review, {formatDate(latest.date)}: difficulty {latest.difficulty}, density{' '}
          {latest.density}, energy {latest.energy} (each from 1 to 5).
        </p>
      ) : null}

      <details className="rounded-sm border border-border">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 font-bold">
          Show the data as a table
        </summary>
        <div className="overflow-x-auto px-3 pb-3">
          <table className="w-full min-w-72 border-collapse text-left tabular-nums">
            <caption className="sr-only">Daily ratings from 1 to 5</caption>
            <thead>
              <tr>
                <th scope="col" className="border-b border-border py-2 pr-3">
                  Date
                </th>
                {SERIES.map((s) => (
                  <th key={s.key} scope="col" className="border-b border-border py-2 pr-3">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date}>
                  <th scope="row" className="border-b border-border py-2 pr-3 font-normal">
                    {formatDate(p.date, 'short')}
                  </th>
                  {SERIES.map((s) => (
                    <td key={s.key} className="border-b border-border py-2 pr-3">
                      {p[s.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** How the last 30 days felt, from the stored reviews (spec 3.4). A chart with a table alternative. */
export function ReviewTrend({ planId, date }: { planId: string; date: string }) {
  const from = addDays(date, -(WINDOW_DAYS - 1));
  const query = useReviewHistory(planId, from, date);
  return (
    <section aria-labelledby="trend-heading" className="space-y-3">
      <h2 id="trend-heading">The last 30 days</h2>
      <QueryView query={query} label="Loading your review history…">
        {({ reviews }) =>
          reviews.length === 0 ? (
            <p className="text-muted">
              No reviews in this period yet. The trend appears after your first review.
            </p>
          ) : (
            <Chart points={reviews} from={from} to={date} />
          )
        }
      </QueryView>
    </section>
  );
}
