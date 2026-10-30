import { parseTime } from '../dates';
import {
  TaskSchema,
  WeekPatternSchema,
  type Block,
  type Task,
  type TaskInput,
  type WeekPattern,
} from '../schemas';

/** Sunday–Thursday, 7 hours, 09:00–17:30 with lunch 13:00–14:00 (the spec's example settings). */
export const basePattern: WeekPattern = WeekPatternSchema.parse({
  studyWeekdays: [0, 1, 2, 3, 4],
  defaultHours: 7,
  windowStart: '09:00',
  windowEnd: '17:30',
  lunchStart: '13:00',
  lunchEnd: '14:00',
  timezone: 'Asia/Jerusalem',
});

let counter = 0;
export function task(input: Partial<TaskInput> & { estHours: number }): Task {
  counter++;
  return TaskSchema.parse({
    id: input.id ?? `t${counter}`,
    title: input.title ?? `Task ${counter}`,
    type: input.type ?? 'course',
    order: input.order ?? counter,
    ...input,
  });
}

export function minutesOn(blocks: Block[], date: string, taskId?: string): number {
  return blocks
    .filter((b) => b.date === date && (taskId === undefined || b.taskId === taskId))
    .reduce((s, b) => s + b.minutes, 0);
}

export function startOf(b: Block): number {
  return parseTime(b.start);
}

export function endOf(b: Block): number {
  return parseTime(b.end);
}
