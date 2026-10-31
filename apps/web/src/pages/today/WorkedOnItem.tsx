import { useState } from 'react';
import type { LogResult, Task } from '../../api/client';
import { TaskStatusLabel, TaskTypeChip } from '../../components/TaskChips';
import { formatHours } from '../../lib/format';
import { TASK_TYPE_META } from '../../lib/task-types';
import { LogTimeForm } from './LogTimeForm';
import { TaskActions } from './TaskActions';

/**
 * A task worked on today that has no block left. The person can still log time, mark it done or
 * skip it, whether or not the "estimate reached" question was answered.
 */
export function WorkedOnItem({
  planId,
  task,
  today,
  loggedToday,
  busy,
  onLogged,
  onDone,
  onSkip,
  onReopen,
}: {
  planId: string;
  task: Task;
  today: string;
  loggedToday: number;
  busy: boolean;
  onLogged: (result: LogResult) => void;
  onDone: () => void;
  onSkip: () => void;
  onReopen: () => void;
}) {
  const [logging, setLogging] = useState(false);
  const remaining = task.estHours - task.doneHours;
  return (
    <li
      className={`space-y-3 rounded-md border border-l-4 border-border bg-surface p-4 ${TASK_TYPE_META[task.type].strip}`}
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <TaskTypeChip type={task.type} />
          <TaskStatusLabel status={task.status} />
        </div>
        <h3 className="text-lg font-bold">{task.title}</h3>
        <p className="text-muted tabular-nums">
          Today {formatHours(loggedToday)} · Estimated {formatHours(task.estHours)} · Actual{' '}
          {formatHours(task.doneHours)}
        </p>
      </div>
      <TaskActions
        task={task}
        busy={busy}
        logging={logging}
        onLog={() => setLogging(true)}
        onDone={onDone}
        onSkip={onSkip}
        onReopen={onReopen}
      />
      {logging ? (
        <LogTimeForm
          planId={planId}
          task={task}
          date={today}
          defaultHours={remaining > 0 ? remaining : 1}
          onLogged={(result) => {
            setLogging(false);
            onLogged(result);
          }}
          onCancel={() => setLogging(false)}
        />
      ) : null}
    </li>
  );
}
