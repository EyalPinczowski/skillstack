import { isLocalDate } from '@skillstack/shared';

/** The date segment of /briefing/:date and /review/:date, if it is a real YYYY-MM-DD date. */
export function validDate(value: string | undefined): string | null {
  return value !== undefined && isLocalDate(value) ? value : null;
}

/** "45 min", "1 h", "1 h 30 min". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
