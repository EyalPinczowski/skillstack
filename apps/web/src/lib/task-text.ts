import type { Task } from '../api/client';
import { formatDate } from './format';

/** "After: Intro to SQL, Setup" for a task that waits for others, otherwise null. */
export function dependencyText(task: Task, titleOf: (id: string) => string): string | null {
  return task.dependsOn.length ? `After: ${task.dependsOn.map(titleOf).join(', ')}` : null;
}

/** "Fixed: Thu, Nov 19, 10:00" for a task with a fixed date and time, otherwise null. */
export function anchorText(task: Task): string | null {
  if (!task.isAnchor || !task.anchorDate) return null;
  const time = task.anchorStartTime ? `, ${task.anchorStartTime}` : '';
  return `Fixed: ${formatDate(task.anchorDate, 'short')}${time}`;
}
