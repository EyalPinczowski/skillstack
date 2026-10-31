import { describe, expect, it } from 'vitest';
import { computeTrend, trendLabel } from './trend';

describe('computeTrend', () => {
  it('is on track when the projected finish is the plan end date (boundary)', () => {
    expect(computeTrend('2026-11-26', '2026-11-26')).toEqual({ status: 'on_track', days: 0 });
  });

  it('is ahead one day early and behind one day late (boundaries)', () => {
    expect(computeTrend('2026-11-25', '2026-11-26')).toEqual({ status: 'ahead', days: -1 });
    expect(computeTrend('2026-11-27', '2026-11-26')).toEqual({ status: 'behind', days: 1 });
  });

  it('counts calendar days across a month end', () => {
    expect(computeTrend('2026-12-03', '2026-11-28')).toEqual({ status: 'behind', days: 5 });
    expect(computeTrend('2026-11-28', '2026-12-03')).toEqual({ status: 'ahead', days: -5 });
  });

  it('is unknown without a finish date or without a plan end date', () => {
    expect(computeTrend(null, '2026-11-26').status).toBe('unknown');
    expect(computeTrend('2026-11-26', null).status).toBe('unknown');
    expect(computeTrend(null, null).status).toBe('unknown');
  });
});

describe('trendLabel', () => {
  it('says it in words, with the right plural', () => {
    expect(trendLabel({ status: 'ahead', days: -1 })).toBe('Ahead of plan by 1 day');
    expect(trendLabel({ status: 'ahead', days: -6 })).toBe('Ahead of plan by 6 days');
    expect(trendLabel({ status: 'behind', days: 1 })).toBe('Behind plan by 1 day');
    expect(trendLabel({ status: 'behind', days: 4 })).toBe('Behind plan by 4 days');
    expect(trendLabel({ status: 'on_track', days: 0 })).toBe('On track');
    expect(trendLabel({ status: 'unknown', days: 0 })).toBe('Trend not available');
  });
});
