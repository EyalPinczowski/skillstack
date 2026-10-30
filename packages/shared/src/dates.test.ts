import { describe, expect, it } from 'vitest';
import {
  addDays,
  compareDates,
  diffDays,
  formatTime,
  hoursToMinutes,
  isLocalDate,
  parseTime,
  weekday,
} from './dates';
import { localDateOf, utcOffsetMinutes, zonedTimeToUtc } from './zone';

describe('local dates', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
  });

  it('counts days between dates', () => {
    expect(diffDays('2026-11-01', '2026-11-26')).toBe(25);
    expect(diffDays('2026-11-26', '2026-11-01')).toBe(-25);
  });

  it('knows the weekday (0 = Sunday)', () => {
    expect(weekday('2026-11-01')).toBe(0);
    expect(weekday('2026-11-26')).toBe(4);
    expect(weekday('2026-11-27')).toBe(5);
  });

  it('rejects impossible dates', () => {
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('2026-11-1')).toBe(false);
    expect(isLocalDate('2028-02-29')).toBe(true);
  });

  it('compares dates', () => {
    expect(compareDates('2026-11-01', '2026-11-02')).toBe(-1);
    expect(compareDates('2026-11-02', '2026-11-02')).toBe(0);
  });
});

describe('times of day', () => {
  it('parses and formats HH:MM', () => {
    expect(parseTime('09:00')).toBe(540);
    expect(parseTime('17:30')).toBe(1050);
    expect(formatTime(1050)).toBe('17:30');
    expect(() => parseTime('24:00')).toThrow();
  });

  it('turns hour estimates into whole minutes', () => {
    expect(hoursToMinutes(0.25)).toBe(15);
    expect(hoursToMinutes(2.5)).toBe(150);
  });
});

describe('time zones', () => {
  it('handles a daylight-saving change: 09:00 in New York on both sides of 1 Nov 2026', () => {
    // US clocks go back on Sunday 1 November 2026.
    expect(zonedTimeToUtc('2026-10-31', 540, 'America/New_York').toISOString()).toBe(
      '2026-10-31T13:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-11-01', 540, 'America/New_York').toISOString()).toBe(
      '2026-11-01T14:00:00.000Z',
    );
  });

  it('reports the offset for Israel in winter (UTC+2)', () => {
    expect(utcOffsetMinutes(Date.parse('2026-11-10T10:00:00Z'), 'Asia/Jerusalem')).toBe(120);
  });

  it('keeps a timestamp created at 23:30 local time on the correct local date', () => {
    const instant = zonedTimeToUtc('2026-11-10', 23 * 60 + 30, 'Asia/Jerusalem');
    expect(instant.toISOString()).toBe('2026-11-10T21:30:00.000Z');
    expect(localDateOf(instant, 'Asia/Jerusalem')).toBe('2026-11-10');
    // In UTC the same instant is still 10 Nov, but in Tokyo it is already 11 Nov.
    expect(localDateOf(instant, 'Asia/Tokyo')).toBe('2026-11-11');
  });
});
