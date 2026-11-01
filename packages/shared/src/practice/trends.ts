/** Score trends per practice kind. Pure. */

export interface PracticeScorePoint {
  practiceKind: string;
  /** 0 to 10; null for a practice saved as free text, which is not part of a trend. */
  score: number | null;
  /** ISO timestamp or local date (anything `Date.parse` reads); entries are ordered by it. */
  at: string;
}

export interface KindTrend {
  practiceKind: string;
  /** How many scored practices. */
  count: number;
  last: number;
  average: number;
  /** Last score minus the one before it; null with a single score. */
  delta: number | null;
  /** Scores in time order. */
  scores: number[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** One trend per kind that has at least one score, sorted by kind. */
export function trendsByKind(points: readonly PracticeScorePoint[]): KindTrend[] {
  const byKind = new Map<string, PracticeScorePoint[]>();
  for (const p of points) {
    if (p.score === null || !Number.isFinite(p.score) || p.score < 0 || p.score > 10) continue;
    if (Number.isNaN(Date.parse(p.at))) continue;
    const list = byKind.get(p.practiceKind) ?? [];
    list.push(p);
    byKind.set(p.practiceKind, list);
  }
  const trends: KindTrend[] = [];
  for (const [practiceKind, list] of byKind) {
    // Array.prototype.sort is stable, so equal timestamps keep their input order.
    const scores = [...list]
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      .map((p) => p.score as number);
    const last = scores[scores.length - 1] as number;
    const previous = scores[scores.length - 2];
    trends.push({
      practiceKind,
      count: scores.length,
      last,
      average: round1(scores.reduce((a, b) => a + b, 0) / scores.length),
      delta: previous === undefined ? null : round1(last - previous),
      scores,
    });
  }
  return trends.sort((a, b) => (a.practiceKind < b.practiceKind ? -1 : 1));
}
