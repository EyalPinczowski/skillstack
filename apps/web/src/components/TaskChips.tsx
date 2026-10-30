import type { TaskType } from '../api/client';
import { TASK_STATUS_META, TASK_TYPE_META, type TaskStatus } from '../lib/task-types';

export function TaskTypeChip({ type }: { type: TaskType }) {
  const { label, chip, Icon } = TASK_TYPE_META[type];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-sm font-bold ${chip}`}
    >
      <Icon />
      {label}
    </span>
  );
}

export function TaskStatusLabel({ status }: { status: TaskStatus }) {
  const { label, Icon } = TASK_STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1 text-sm text-muted">
      <Icon />
      {label}
    </span>
  );
}
