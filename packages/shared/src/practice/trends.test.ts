import { describe, expect, it } from 'vitest';
import { trendsByKind } from './trends';

describe('trendsByKind input hygiene', () => {
  it('orders by parsed time, not by string', () => {
    const t = trendsByKind([
      { practiceKind: 'a', score: 9, at: '2026-11-10T08:00:00Z' },
      { practiceKind: 'a', score: 3, at: '2026-11-09T23:00:00-05:00' },
      { practiceKind: 'a', score: 5, at: '2026-11-10T01:00:00+09:00' },
    ]);
    // 11-09 23:00-05 is 11-10 04:00Z; 11-10 01:00+09 is 11-09 16:00Z.
    expect(t[0]?.scores).toEqual([5, 3, 9]);
  });
  it('skips unparseable dates and out-of-range or non-finite scores', () => {
    const t = trendsByKind([
      { practiceKind: 'a', score: 4, at: '2026-11-01' },
      { practiceKind: 'a', score: 4, at: 'not a date' },
      { practiceKind: 'a', score: 11, at: '2026-11-02' },
      { practiceKind: 'a', score: -1, at: '2026-11-03' },
      { practiceKind: 'a', score: NaN, at: '2026-11-04' },
      { practiceKind: 'a', score: Infinity, at: '2026-11-05' },
      { practiceKind: 'a', score: 6, at: '2026-11-06' },
      { practiceKind: 'b', score: 99, at: '2026-11-06' },
    ]);
    expect(t).toEqual([
      { practiceKind: 'a', count: 2, last: 6, average: 5, delta: 2, scores: [4, 6] },
    ]);
  });

  it('accepts only strict ISO 8601, and reads zone-less times as UTC', () => {
    const t = trendsByKind([
      { practiceKind: 'a', score: 1, at: '0' },
      { practiceKind: 'a', score: 2, at: 'Jan 1' },
      { practiceKind: 'a', score: 3, at: '2026-13-45' },
      { practiceKind: 'a', score: 4, at: '2026-11-01T10:00' },
      { practiceKind: 'a', score: 5, at: '2026-11-01T10:00:30.5Z' },
      { practiceKind: 'a', score: 6, at: '2026-11-01' },
    ]);
    // date-only and zone-less date-time are both UTC: 00:00, 10:00, 10:00:30.5
    expect(t[0]?.scores).toEqual([6, 4, 5]);
  });
  it('sorts kinds in both insertion orders', () => {
    const a = { practiceKind: 'a', score: 1, at: '2026-11-01' };
    const b = { practiceKind: 'b', score: 2, at: '2026-11-01' };
    expect(trendsByKind([a, b]).map((x) => x.practiceKind)).toEqual(['a', 'b']);
    expect(trendsByKind([b, a]).map((x) => x.practiceKind)).toEqual(['a', 'b']);
  });
});
