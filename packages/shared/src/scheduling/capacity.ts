import { hoursToMinutes, parseTime, weekday, type LocalDate, type Minutes } from '../dates';
import type { BusyInterval, DayOverride, WeekPattern } from '../schemas';

/** A half-open time range on one day, [start, end), in minutes since midnight. */
export interface Interval {
  start: Minutes;
  end: Minutes;
}

export interface DayCapacity {
  date: LocalDate;
  isStudyDay: boolean;
  /** Study minutes from the pattern or an override, before busy events. */
  baseMinutes: number;
  /** Minutes of busy events that overlap study time (the window minus lunch). */
  busyMinutes: number;
  /** Study minutes available: base minus busy, never below zero. */
  capacityMinutes: number;
}

export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** `from` minus every interval in `remove`. */
export function subtractIntervals(from: Interval[], remove: Interval[]): Interval[] {
  let result = mergeIntervals(from);
  for (const r of mergeIntervals(remove)) {
    const next: Interval[] = [];
    for (const i of result) {
      if (r.end <= i.start || r.start >= i.end) {
        next.push(i);
        continue;
      }
      if (r.start > i.start) next.push({ start: i.start, end: r.start });
      if (r.end < i.end) next.push({ start: r.end, end: i.end });
    }
    result = next;
  }
  return result;
}

export function totalMinutes(intervals: Interval[]): number {
  return intervals.reduce((sum, i) => sum + (i.end - i.start), 0);
}

export function findOverride(date: LocalDate, overrides: DayOverride[]): DayOverride | undefined {
  return overrides.find((o) => o.date === date);
}

export function isStudyDay(
  date: LocalDate,
  pattern: WeekPattern,
  overrides: DayOverride[],
): boolean {
  const override = findOverride(date, overrides);
  return override ? override.isStudyDay : pattern.studyWeekdays.includes(weekday(date));
}

/** The daily window minus the lunch break: the only times study blocks may use. */
export function studyWindow(pattern: WeekPattern): Interval[] {
  const window = { start: parseTime(pattern.windowStart), end: parseTime(pattern.windowEnd) };
  if (!pattern.lunchStart || !pattern.lunchEnd) return [window];
  return subtractIntervals(
    [window],
    [{ start: parseTime(pattern.lunchStart), end: parseTime(pattern.lunchEnd) }],
  );
}

export function busyIntervalsOn(date: LocalDate, busy: BusyInterval[]): Interval[] {
  return mergeIntervals(
    busy
      .filter((b) => b.date === date)
      .map((b) => ({ start: parseTime(b.start), end: parseTime(b.end) })),
  );
}

/**
 * How much study time a day has (spec 3.7 and 3.8): the weekday's hours, or a one-off
 * override, minus busy calendar events that fall inside study time. A 2-hour busy event on
 * a 7-hour day leaves 5 hours.
 */
export function dayCapacity(
  date: LocalDate,
  pattern: WeekPattern,
  overrides: DayOverride[] = [],
  busy: BusyInterval[] = [],
): DayCapacity {
  if (!isStudyDay(date, pattern, overrides)) {
    return { date, isStudyDay: false, baseMinutes: 0, busyMinutes: 0, capacityMinutes: 0 };
  }
  const override = findOverride(date, overrides);
  const hours =
    override?.capacityHours ??
    pattern.hoursByWeekday[String(weekday(date))] ??
    pattern.defaultHours;
  const baseMinutes = hoursToMinutes(hours);
  const window = studyWindow(pattern);
  const busyInside =
    totalMinutes(window) - totalMinutes(subtractIntervals(window, busyIntervalsOn(date, busy)));
  return {
    date,
    isStudyDay: true,
    baseMinutes,
    busyMinutes: busyInside,
    capacityMinutes: Math.max(0, baseMinutes - busyInside),
  };
}
