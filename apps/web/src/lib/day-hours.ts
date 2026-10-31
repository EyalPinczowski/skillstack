import { addDays, compareDates } from '@skillstack/shared';
import type { Block } from '../api/client';
import { formatHours, weekdayShort } from './format';

export interface DayHours {
  planned: number;
  completed: number;
  remaining: number;
}

const sumHours = (blocks: Block[], date: string) =>
  blocks.filter((b) => b.date === date).reduce((sum, b) => sum + b.minutes, 0) / 60;

/**
 * Planned, completed and remaining hours of one day, from the schedule's blocks and the hours
 * logged on that date (progress.byDay).
 *
 * A frozen day (ended, or past) keeps the blocks it was planned with, so planned is their sum.
 * A day that is still open is scheduled again after every log, so its blocks are only what is
 * left: planned is then what was logged plus what is left. Remaining never goes below zero.
 */
export function dayHours(blocks: Block[], date: string, logged: number, frozen: boolean): DayHours {
  const scheduled = sumHours(blocks, date);
  const planned = frozen ? scheduled : scheduled + logged;
  return { planned, completed: logged, remaining: Math.max(0, planned - logged) };
}

export interface WeekDay extends DayHours {
  date: string;
  isToday: boolean;
}

/** The seven days from `weekStart`, each with its hours. `todayFrozen` says whether today has ended. */
export function weekDays(
  blocks: Block[],
  byDay: { date: string; hours: number }[],
  weekStart: string,
  today: string,
  todayFrozen: boolean,
): WeekDay[] {
  const loggedOn = new Map(byDay.map((d) => [d.date, d.hours]));
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const frozen = compareDates(date, today) < 0 || (date === today && todayFrozen);
    return {
      date,
      isToday: date === today,
      ...dayHours(blocks, date, loggedOn.get(date) ?? 0, frozen),
    };
  });
}

export interface WeekTotals {
  plannedHours: number;
  actualHours: number;
  tasksPlanned: number;
  tasksDone: number;
}

/**
 * Week totals. Tasks planned are the tasks with at least one block in the week; done are those of
 * them whose status is done now.
 */
export function weekTotals(
  days: WeekDay[],
  blocks: Block[],
  taskStatus: Map<string, string>,
  weekStart: string,
  weekEnd: string,
): WeekTotals {
  const planned = new Set(
    blocks
      .filter((b) => compareDates(b.date, weekStart) >= 0 && compareDates(b.date, weekEnd) <= 0)
      .map((b) => b.taskId),
  );
  return {
    plannedHours: days.reduce((sum, d) => sum + d.planned, 0),
    actualHours: days.reduce((sum, d) => sum + d.completed, 0),
    tasksPlanned: planned.size,
    tasksDone: [...planned].filter((id) => taskStatus.get(id) === 'done').length,
  };
}

/** The text alternative: one sentence per day. Also read out as the chart's name. */
export function chartSummary(days: WeekDay[]): string {
  return days
    .map(
      (d) =>
        `${weekdayShort(d.date)}: ${formatHours(d.completed)} done of ${formatHours(d.planned)} planned`,
    )
    .join('. ');
}
