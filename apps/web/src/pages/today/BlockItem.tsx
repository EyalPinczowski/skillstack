import { useState } from 'react';
import type { Block, LogResult, Task } from '../../api/client';
import { TaskStatusLabel, TaskTypeChip } from '../../components/TaskChips';
import { PinIcon } from '../../components/icons';
import { formatHours, minutesToHours } from '../../lib/format';
import { TASK_TYPE_META } from '../../lib/task-types';
import { LogTimeForm } from './LogTimeForm';
import { TaskActions } from './TaskActions';

/** One block of today's schedule: what, when, how long, and the actions the person may choose. */
export function BlockItem({
  planId,
  block,
  task,
  today,
  busy,
  onLogged,
  onDone,
  onSkip,
  onReopen,
}: {
  planId: string;
  block: Block;
  task: Task;
  today: string;
  /** True while a mark-done or skip for this task is running. */
  busy: boolean;
  onLogged: (result: LogResult) => void;
  onDone: () => void;
  onSkip: () => void;
  onReopen: () => void;
}) {
  const [logging, setLogging] = useState(false);
  const blockHours = minutesToHours(block.minutes);
  const fixed = block.kind !== 'study';
  return (
    <li
      className={`space-y-3 rounded-md border border-l-4 border-border bg-surface p-4 ${TASK_TYPE_META[task.type].strip}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <TaskTypeChip type={task.type} />
        <TaskStatusLabel status={task.status} />
        {fixed ? (
          <span className="inline-flex items-center gap-1 text-sm text-muted">
            <PinIcon />
            Fixed time
          </span>
        ) : null}
      </div>
      <div className="space-y-1">
        <h3 className="text-lg font-bold">{task.title}</h3>
        <p className="text-muted tabular-nums">
          <time>
            {block.start}–{block.end}
          </time>
          {' · '}
          {formatHours(blockHours)}
        </p>
        <p className="text-muted tabular-nums">
          Estimated {formatHours(task.estHours)} · Actual {formatHours(task.doneHours)}
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
          defaultHours={blockHours}
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
