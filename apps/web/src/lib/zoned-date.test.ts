import { describe, expect, it } from 'vitest';
import { dateInZone, msUntilMidnight } from './zoned-date';

const at = (iso: string) => Date.parse(iso);

describe('dateInZone', () => {
  it('gives the calendar date in the zone, not in UTC', () => {
    const instant = at('2026-11-10T22:30:00Z');
    expect(dateInZone(instant, 'UTC')).toBe('2026-11-10');
    expect(dateInZone(instant, 'Asia/Jerusalem')).toBe('2026-11-11');
    expect(dateInZone(instant, 'America/New_York')).toBe('2026-11-10');
    expect(dateInZone(instant, 'Pacific/Auckland')).toBe('2026-11-11');
  });

  it('switches exactly at local midnight', () => {
    expect(dateInZone(at('2026-11-10T21:59:59.999Z'), 'Asia/Jerusalem')).toBe('2026-11-10');
    expect(dateInZone(at('2026-11-10T22:00:00.000Z'), 'Asia/Jerusalem')).toBe('2026-11-11');
  });

  it('returns null for an unknown zone instead of throwing', () => {
    expect(dateInZone(Date.now(), 'Not/AZone')).toBeNull();
  });
});

describe('msUntilMidnight', () => {
  it('counts to the next local midnight', () => {
    expect(msUntilMidnight(at('2026-11-10T21:55:00Z'), 'Asia/Jerusalem')).toBe(5 * 60_000);
    expect(msUntilMidnight(at('2026-11-10T22:00:00Z'), 'Asia/Jerusalem')).toBe(24 * 3_600_000);
    expect(msUntilMidnight(at('2026-11-10T23:59:59.250Z'), 'UTC')).toBe(750);
  });

  it('returns null for an unknown zone', () => {
    expect(msUntilMidnight(Date.now(), 'Not/AZone')).toBeNull();
  });
});
