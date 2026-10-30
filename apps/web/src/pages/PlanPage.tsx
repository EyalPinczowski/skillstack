import { Link } from 'react-router';
import type { Task } from '../api/client';
import { useTasks } from '../api/hooks';
import { QueryView } from '../components/QueryView';
import { TaskStatusLabel, TaskTypeChip } from '../components/TaskChips';
import { linkClass } from '../components/ui';
import { formatHours } from '../lib/format';
import { anchorText, dependencyText } from '../lib/task-text';
import { TASK_TYPE_META } from '../lib/task-types';
import { PlanGate, PlanSwitcher } from '../plan/PlanGate';

function TaskRow({ task, titleOf }: { task: Task; titleOf: (id: string) => string }) {
  const deps = dependencyText(task, titleOf);
  const anchor = anchorText(task);
  return (
    <li
      className={`space-y-2 rounded-md border border-l-4 border-border bg-surface p-4 ${TASK_TYPE_META[task.type].strip}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <TaskTypeChip type={task.type} />
        <TaskStatusLabel status={task.status} />
        <span className="ml-auto text-muted tabular-nums">
          {formatHours(task.doneHours)} of {formatHours(task.estHours)}
        </span>
      </div>
      <h3 className="text-lg font-bold">
        <Link
          to={`/plan/${encodeURIComponent(task.id)}`}
          className={`${linkClass} inline-block min-h-11 py-2`}
        >
          {task.title}
        </Link>
      </h3>
      {anchor ? <p className="font-bold">{anchor}</p> : null}
      {deps ? <p className="text-muted">{deps}</p> : null}
    </li>
  );
}

/** Every task of the plan, in plan order. */
export function PlanPage() {
  return (
    <div className="space-y-6">
      <h1>Plan</h1>
      <PlanSwitcher />
      <PlanGate
        empty={
          <p className="text-muted">
            No plan yet. Import one from{' '}
            <Link to="/" className={linkClass}>
              Today
            </Link>
            .
          </p>
        }
      >
        {(plan) => <TaskList planId={plan.id} name={plan.name} />}
      </PlanGate>
    </div>
  );
}

function TaskList({ planId, name }: { planId: string; name: string }) {
  const tasks = useTasks(planId);
  return (
    <QueryView query={tasks} label="Loading your tasks…">
      {({ tasks: list }) => {
        const titleOf = (id: string) => list.find((t) => t.id === id)?.title ?? id;
        return (
          <section aria-labelledby="tasks-heading" className="space-y-3">
            <h2 id="tasks-heading">{name}</h2>
            <p className="text-muted">{list.length} tasks</p>
            <ul className="space-y-3">
              {list.map((task) => (
                <TaskRow key={task.id} task={task} titleOf={titleOf} />
              ))}
            </ul>
          </section>
        );
      }}
    </QueryView>
  );
}
