import type { Block, DayState, Task } from '../../api/client';
import { useDay, useProgress } from '../../api/hooks';
import { QueryView } from '../../components/QueryView';
import { TaskStatusLabel, TaskTypeChip } from '../../components/TaskChips';
import { LockIcon } from '../../components/icons';
import { dayHours } from '../../lib/day-hours';
import { formatHours, minutesToHours } from '../../lib/format';
import { TASK_TYPE_META } from '../../lib/task-types';
import { DayHoursSummary } from './DayHoursSummary';

function FrozenBlock({ block, task }: { block: Block; task: Task | undefined }) {
  return (
    <li
      className={`space-y-1 rounded-md border border-l-4 border-border bg-surface p-4 ${task ? TASK_TYPE_META[task.type].strip : ''}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {task ? <TaskTypeChip type={task.type} /> : null}
        {task ? <TaskStatusLabel status={task.status} /> : null}
      </div>
      <h3 className="text-lg font-bold">{task?.title ?? block.taskId}</h3>
      <p className="text-muted tabular-nums">
        <time>
          {block.start}–{block.end}
        </time>
        {' · '}
        {formatHours(minutesToHours(block.minutes))}
      </p>
    </li>
  );
}

function Frozen({
  planId,
  day,
  tasksById,
}: {
  planId: string;
  day: DayState;
  tasksById: Map<string, Task>;
}) {
  const progress = useProgress(planId);
  const blocks = day.frozen?.blocks ?? [];
  return (
    <>
      <p className="flex items-center gap-2 font-bold">
        <LockIcon />
        {day.status === 'ended'
          ? 'Day ended'
          : day.status === 'started'
            ? 'Day started'
            : 'Day not started'}
        {' · frozen, read-only'}
      </p>
      <QueryView query={progress} label="Loading the hours…">
        {(data) => {
          const logged = data.byDay.find((d) => d.date === day.date)?.hours ?? 0;
          return (
            <DayHoursSummary
              label="Hours of this day"
              hours={dayHours(blocks, day.date, logged, true)}
            />
          );
        }}
      </QueryView>
      <section aria-labelledby="past-blocks-heading" className="space-y-3">
        <h2 id="past-blocks-heading">Planned blocks</h2>
        {blocks.length === 0 ? (
          <p className="text-muted">Nothing was planned for this day.</p>
        ) : (
          <ul className="space-y-3">
            {blocks.map((block) => (
              <FrozenBlock
                key={`${block.taskId}-${block.start}`}
                block={block}
                task={tasksById.get(block.taskId)}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** A day before today: the blocks it was frozen with, read-only. No action can change it. */
export function PastDayView({
  planId,
  date,
  tasksById,
}: {
  planId: string;
  date: string;
  tasksById: Map<string, Task>;
}) {
  const day = useDay(planId, date);
  return (
    <QueryView query={day} label="Loading this day…">
      {(data) =>
        data.frozen ? (
          <Frozen planId={planId} day={data} tasksById={tasksById} />
        ) : (
          <p className="text-muted">Nothing was recorded for this day.</p>
        )
      }
    </QueryView>
  );
}
