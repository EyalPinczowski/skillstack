import { parseLocalDate, type LocalDate, type Minutes } from './dates';

/** True when the platform's time-zone database knows `timeZone` (e.g. `Asia/Jerusalem`). */
export function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Offset of `timeZone` from UTC at the given instant, in minutes (e.g. +120 for UTC+2).
 * Uses the platform's time-zone database through `Intl`, so no extra dependency.
 */
export function utcOffsetMinutes(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Missing ${type} for time zone ${timeZone}`);
    return Number(part.value);
  };
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - instantMs) / 60_000);
}

/**
 * The instant at which the wall clock in `timeZone` shows `date` at `minutes` past midnight.
 * Two passes handle days on which the offset changes (daylight-saving transitions).
 */
export function zonedTimeToUtc(date: LocalDate, minutes: Minutes, timeZone: string): Date {
  const { year, month, day } = parseLocalDate(date);
  const wallClockAsUtc = Date.UTC(year, month - 1, day) + minutes * 60_000;
  let guess = wallClockAsUtc - utcOffsetMinutes(wallClockAsUtc, timeZone) * 60_000;
  guess = wallClockAsUtc - utcOffsetMinutes(guess, timeZone) * 60_000;
  return new Date(guess);
}

/** The local calendar date in `timeZone` for an instant (e.g. 23:30 local stays on that date). */
export function localDateOf(instant: Date, timeZone: string): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
