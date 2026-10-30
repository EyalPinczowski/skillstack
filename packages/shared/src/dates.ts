/**
 * Calendar helpers that work on local dates and local clock times, never on instants.
 *
 * A study day is stored as a local date (`YYYY-MM-DD`) and times of day as minutes since
 * local midnight. Conversion to real instants happens only at the edges (see `zone.ts`),
 * so the scheduling engine is independent of time zones and daylight-saving changes.
 */

/** A local calendar date, `YYYY-MM-DD`. */
export type LocalDate = string;
/** Minutes since local midnight, 0–1439. */
export type Minutes = number;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MS_PER_DAY = 86_400_000;

export function parseLocalDate(date: LocalDate): { year: number; month: number; day: number } {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid local date: ${date}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error(`Invalid local date: ${date}`);
  }
  return { year, month, day };
}

export function isLocalDate(value: string): boolean {
  try {
    parseLocalDate(value);
    return true;
  } catch {
    return false;
  }
}

function toDayNumber(date: LocalDate): number {
  const { year, month, day } = parseLocalDate(date);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

function fromDayNumber(n: number): LocalDate {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromDayNumber(toDayNumber(date) + days);
}

/** Number of days from `from` to `to` (negative when `to` is earlier). */
export function diffDays(from: LocalDate, to: LocalDate): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** Day of the week: 0 = Sunday … 6 = Saturday. */
export function weekday(date: LocalDate): number {
  return new Date(toDayNumber(date) * MS_PER_DAY).getUTCDay();
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function parseTime(time: string): Minutes {
  const m = TIME_RE.exec(time);
  if (!m) throw new Error(`Invalid time: ${time}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function isTime(value: string): boolean {
  return TIME_RE.test(value);
}

export function formatTime(minutes: Minutes): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 24 * 60) {
    throw new Error(`Invalid minutes: ${minutes}`);
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Hours to whole minutes (estimates like 0.25 h or 2.5 h become 15 and 150). */
export function hoursToMinutes(hours: number): number {
  return Math.round(hours * 60);
}

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
