import { diffDays, parseLocalDate } from '@skillstack/shared';

/** Formats a local date (YYYY-MM-DD) without any time-zone shift: "Tuesday, Nov 10". */
export function formatDate(date: string, style: 'long' | 'short' = 'long'): string {
  const { year, month, day } = parseLocalDate(date);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    weekday: style,
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** "Mon" for a local date. */
export function weekdayShort(date: string): string {
  const { year, month, day } = parseLocalDate(date);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: 'UTC',
  });
}

/** "Nov 9" for a local date. */
export function monthDay(date: string): string {
  const { year, month, day } = parseLocalDate(date);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** 1.5 -> "1.5 h", 2 -> "2 h". Hours are shown to at most two decimals. */
export function formatHours(hours: number): string {
  return `${Number(hours.toFixed(2))} h`;
}

export function minutesToHours(minutes: number): number {
  return minutes / 60;
}

/**
 * "Day N of M" from the plan's start date, today's date and the schedule's finish date (all given
 * by the API). Null when it cannot be told: before the start, after the finish, or no finish.
 */
export function dayOfPlan(
  startDate: string,
  today: string,
  finishDate: string | null,
): { day: number; total: number } | null {
  if (!finishDate) return null;
  const day = diffDays(startDate, today) + 1;
  const total = diffDays(startDate, finishDate) + 1;
  return day >= 1 && day <= total ? { day, total } : null;
}

/** Whole-number percentage of `part` in `whole`, capped at 100. A zero whole gives 0. */
export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.round((part / whole) * 100));
}

/**
 * "Carried over from Mon, Tue". Days inside the week are named by weekday; an earlier day (a
 * task that has waited since last week) by its date, so two different Mondays never look alike.
 */
export function carriedOverText(dates: string[], weekStart: string): string {
  const names = dates.map((d) => (d < weekStart ? monthDay(d) : weekdayShort(d)));
  return `Carried over from ${names.join(', ')}`;
}
