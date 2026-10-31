import { diffDays } from '@skillstack/shared';

export type TrendStatus = 'ahead' | 'on_track' | 'behind' | 'unknown';

export interface Trend {
  status: TrendStatus;
  /** Calendar days between the plan's end date and the projected finish; positive when later. */
  days: number;
}

/**
 * Ahead, on track or behind, from two dates the API already gives: the finish date of the current
 * schedule (it counts the hours still to do, so it moves with every log and every skipped day)
 * and the end date the plan was made for. Earlier than planned is ahead, the same day is on
 * track, later is behind. There is no tolerance band: a margin would be a number made up here.
 * Without a finish date or a plan end date (nothing left to schedule, or tasks that do not fit) the trend is unknown
 * and the screen says so.
 */
export function computeTrend(finishDate: string | null, planEndDate: string | null): Trend {
  if (!finishDate || !planEndDate) return { status: 'unknown', days: 0 };
  const days = diffDays(planEndDate, finishDate);
  if (days < 0) return { status: 'ahead', days };
  if (days > 0) return { status: 'behind', days };
  return { status: 'on_track', days: 0 };
}

const plural = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

export function trendLabel(trend: Trend): string {
  switch (trend.status) {
    case 'ahead':
      return `Ahead of plan by ${plural(-trend.days)}`;
    case 'behind':
      return `Behind plan by ${plural(trend.days)}`;
    case 'on_track':
      return 'On track';
    default:
      return 'Trend not available';
  }
}
