/**
 * The calendar date ("YYYY-MM-DD") at `ms` in a time zone. Null if the zone is unknown. The
 * schedule's "today" is the date in the plan's zone, so the web must tell days apart the same way.
 */
export function dateInZone(ms: number, timeZone: string): string | null {
  const parts = partsInZone(ms, timeZone);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : null;
}

/** Milliseconds from `ms` until the next midnight in the zone. Null if the zone is unknown. */
export function msUntilMidnight(ms: number, timeZone: string): number | null {
  const parts = partsInZone(ms, timeZone);
  if (!parts) return null;
  const secondsToday = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  // A day can be 23 or 25 hours long where the clocks change; the caller checks the date again
  // when the timer fires, so being an hour early or late for that one night is harmless.
  return (24 * 3600 - secondsToday) * 1000 - (((ms % 1000) + 1000) % 1000);
}

function partsInZone(ms: number, timeZone: string): Record<string, string> | null {
  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(ms);
    return Object.fromEntries(formatted.map((part) => [part.type, part.value]));
  } catch {
    return null;
  }
}
