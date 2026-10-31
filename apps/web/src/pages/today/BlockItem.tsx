import { useState } from 'react';
import type { Block, LogResult, Task } from '../../api/client';
import { TaskStatusLabel, TaskTypeChip } from '../../components/TaskChips';
import { PinIcon } from '../../components/icons';
import { Button } from '../../components/ui';
import { formatHours, minutesToHours } from '../../lib/format';
import { TASK_TYPE_META } from '../../lib/task-types';
import { LogTimeForm } from './LogTimeForm';

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
  // A finished or skipped task (seen on a frozen day) can only be reopened, never logged against.
  const closed = task.status === 'done' || task.status === 'skipped';
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
      {closed ? (
        <div className="flex flex-wrap gap-3">
          <Button onClick={onReopen} disabled={busy}>
            Reopen<span className="sr-only">: {task.title}</span>
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={() => setLogging(true)} disabled={logging || busy}>
            Log time<span className="sr-only">: {task.title}</span>
          </Button>
          <Button onClick={onDone} disabled={busy}>
            Mark done<span className="sr-only">: {task.title}</span>
          </Button>
          <Button onClick={onSkip} disabled={busy}>
            Skip<span className="sr-only">: {task.title}</span>
          </Button>
        </div>
      )}
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
