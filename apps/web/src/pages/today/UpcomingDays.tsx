import { useState } from 'react';
import type { Block, Task } from '../../api/client';
import { TaskTypeChip } from '../../components/TaskChips';
import { Button } from '../../components/ui';
import { formatDate, formatHours, minutesToHours } from '../../lib/format';
import { TASK_TYPE_META } from '../../lib/task-types';

const PAGE = 5;

/** The days after today that have blocks, grouped by date. */
export function UpcomingDays({
  blocks,
  today,
  tasksById,
}: {
  blocks: Block[];
  today: string;
  tasksById: Map<string, Task>;
}) {
  const [shown, setShown] = useState(PAGE);
  const days = new Map<string, Block[]>();
  for (const block of blocks) {
    if (block.date <= today) continue;
    days.set(block.date, [...(days.get(block.date) ?? []), block]);
  }
  const dates = [...days.keys()].sort();
  return (
    <section aria-labelledby="upcoming-heading" className="space-y-3">
      <h2 id="upcoming-heading">Coming up</h2>
      {dates.length === 0 ? (
        <p className="text-muted">Nothing is scheduled after today.</p>
      ) : (
        <>
          <ul className="space-y-4">
            {dates.slice(0, shown).map((date) => {
              const day = days.get(date)!;
              const minutes = day.reduce((sum, b) => sum + b.minutes, 0);
              return (
                <li key={date} className="space-y-1">
                  <h3 className="flex items-baseline justify-between gap-3 font-bold">
                    <span>{formatDate(date, 'short')}</span>
                    <span className="text-muted tabular-nums">
                      {formatHours(minutesToHours(minutes))}
                    </span>
                  </h3>
                  <ul>
                    {day.map((block) => {
                      const task = tasksById.get(block.taskId);
                      return (
                        <li
                          key={`${block.taskId}-${block.start}`}
                          className={`space-y-1 border-l-4 border-b border-b-border py-2 pl-3 ${task ? TASK_TYPE_META[task.type].strip : 'border-border'}`}
                        >
                          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="text-muted tabular-nums">
                              {block.start}–{block.end}
                            </span>
                            {task ? <TaskTypeChip type={task.type} /> : null}
                          </p>
                          <p className="font-bold">{task?.title ?? block.taskId}</p>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
          {shown < dates.length ? (
            <Button onClick={() => setShown(shown + PAGE)}>Show more days</Button>
          ) : null}
        </>
      )}
    </section>
  );
}
