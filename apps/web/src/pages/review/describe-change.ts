import { TASK_TYPE_LABEL, WEEKDAY_NAMES } from '@skillstack/shared';
import type { ProposedChange } from '../../api/review-hooks';
import { formatDate, formatHours } from '../../lib/format';

/** One plain sentence for a proposed change. Display only: the server computes and applies it. */
export function describeChange(
  change: ProposedChange,
  titleOf: (taskId: string) => string,
): string {
  switch (change.kind) {
    case 'capacityDelta': {
      const amount = formatHours(Math.abs(change.hours));
      const verb = change.hours < 0 ? 'Reduce' : 'Add';
      const per = change.hours < 0 ? 'from' : 'to';
      const where =
        change.scope.type === 'weekdays'
          ? `on ${change.scope.weekdays.map((d) => WEEKDAY_NAMES[d] ?? String(d)).join(', ')}`
          : `from ${formatDate(change.scope.from, 'short')} to ${formatDate(change.scope.to, 'short')}`;
      return `${verb} ${amount} ${per} the daily study time ${where}.`;
    }
    case 'estimateUpdate': {
      const percent = Math.round((change.factor - 1) * 100);
      const direction = percent >= 0 ? `up by ${percent}%` : `down by ${-percent}%`;
      const count = change.taskIds.length;
      return `Change the estimates of ${count} unfinished ${TASK_TYPE_LABEL[change.taskType].toLowerCase()} ${count === 1 ? 'task' : 'tasks'} ${direction}.`;
    }
    case 'extraPractice':
      return `Add ${formatHours(change.hours)} of practice after ${titleOf(change.afterTaskId)}.`;
    case 'pullForward':
      return `Pull ${formatHours(change.hours)} of work forward to ${formatDate(change.date, 'short')}.`;
  }
}
