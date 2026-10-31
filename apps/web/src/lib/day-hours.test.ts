import { describe, expect, it } from 'vitest';
import type { Block } from '../api/client';
import { chartSummary, dayHours, weekDays, weekTotals } from './day-hours';

const block = (taskId: string, date: string, minutes: number): Block => ({
  taskId,
  date,
  start: '09:00',
  end: '10:00',
  minutes,
  kind: 'study',
});

describe('dayHours', () => {
  it('a frozen day plans exactly its blocks', () => {
    expect(dayHours([block('a', '2026-11-10', 90)], '2026-11-10', 1, true)).toEqual({
      planned: 1.5,
      completed: 1,
      remaining: 0.5,
    });
  });

  it('an open day adds what was logged to what is left, so work done does not shrink the plan', () => {
    expect(dayHours([block('a', '2026-11-10', 60)], '2026-11-10', 1.5, false)).toEqual({
      planned: 2.5,
      completed: 1.5,
      remaining: 1,
    });
  });

  it('never reports negative remaining when more was logged than planned', () => {
    expect(dayHours([block('a', '2026-11-10', 30)], '2026-11-10', 2, true).remaining).toBe(0);
  });

  it('ignores blocks of other days', () => {
    expect(dayHours([block('a', '2026-11-11', 60)], '2026-11-10', 0, true).planned).toBe(0);
  });
});

describe('week aggregates', () => {
  const blocks = [
    block('setup', '2026-11-09', 30),
    block('sql1', '2026-11-09', 90),
    block('sql1', '2026-11-10', 90),
    block('sql1', '2026-11-11', 120),
    block('sql1', '2026-11-15', 60), // next week: outside
  ];
  const byDay = [
    { date: '2026-11-09', hours: 2 },
    { date: '2026-11-10', hours: 0.5 },
  ];
  const days = weekDays(blocks, byDay, '2026-11-08', '2026-11-10', false);

  it('has seven days from the week start and marks today', () => {
    expect(days.map((d) => d.date)).toEqual([
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
    ]);
    expect(days.filter((d) => d.isToday).map((d) => d.date)).toEqual(['2026-11-10']);
  });

  it('plans a past day from its frozen blocks and today from what is left plus what was logged', () => {
    expect(days[1]).toMatchObject({ planned: 2, completed: 2, remaining: 0 });
    expect(days[2]).toMatchObject({ planned: 2, completed: 0.5, remaining: 1.5 });
    expect(days[3]).toMatchObject({ planned: 2, completed: 0 });
  });

  it('treats today as frozen once the day has ended', () => {
    const ended = weekDays(blocks, byDay, '2026-11-08', '2026-11-10', true);
    expect(ended[2]).toMatchObject({ planned: 1.5, completed: 0.5, remaining: 1 });
  });

  it('totals hours and counts the tasks with a block in the week, and those that are done', () => {
    const totals = weekTotals(
      days,
      blocks,
      new Map([
        ['setup', 'done'],
        ['sql1', 'in_progress'],
      ]),
      '2026-11-08',
      '2026-11-14',
    );
    expect(totals).toEqual({ plannedHours: 6, actualHours: 2.5, tasksPlanned: 2, tasksDone: 1 });
  });

  it('gives a text alternative with one sentence per day', () => {
    const text = chartSummary(days);
    expect(text).toContain('Mon: 2 h done of 2 h planned');
    expect(text).toContain('Tue: 0.5 h done of 2 h planned');
    expect(text.split('. ')).toHaveLength(7);
  });
});
