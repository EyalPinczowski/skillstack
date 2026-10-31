import { compareDates, LocalDateSchema } from '@skillstack/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { LogResult, PlanSummary, Schedule, Task } from '../../api/client';
import {
  useDay,
  useLogs,
  useProgress,
  useSchedule,
  useTaskAction,
  useTasks,
} from '../../api/hooks';
import { QueryView } from '../../components/QueryView';
import { TaskStatusLabel, TaskTypeChip } from '../../components/TaskChips';
import { Button, ErrorText, linkClass } from '../../components/ui';
import { dayHours } from '../../lib/day-hours';
import { dayOfPlan, formatDate, formatHours } from '../../lib/format';
import { describeError } from '../../lib/messages';
import { TASK_TYPE_META } from '../../lib/task-types';
import { PlanSwitcher } from '../../plan/PlanGate';
import { BlockItem } from './BlockItem';
import { DayControls } from './DayControls';
import { DayHoursSummary } from './DayHoursSummary';
import { DayPicker } from './DayPicker';
import { PastDayView } from './PastDayView';
import { UpcomingDays } from './UpcomingDays';
import { useDayRollover } from './use-day-rollover';
import { WarningsNotice } from './WarningsNotice';

type Notice = { tone: 'ok'; text: string; undoTaskId?: string } | { tone: 'error'; text: string };

/** The day: date, hours, start and end of the day, today's blocks and what comes next. */
export function Home({ plan }: { plan: PlanSummary }) {
  const schedule = useSchedule(plan.id);
  const tasks = useTasks(plan.id);
  useDayRollover(plan.id, schedule);
  return (
    <div className="space-y-6">
      <h1>Today</h1>
      <PlanSwitcher />
      <QueryView query={schedule} label="Loading your schedule…">
        {(sched) => (
          <QueryView query={tasks} label="Loading your tasks…">
            {({ tasks: list }) => <Day plan={plan} schedule={sched} tasks={list} />}
          </QueryView>
        )}
      </QueryView>
    </div>
  );
}

/** The day in the address (?date=), or today. A malformed value counts as today. */
function useSelectedDate(today: string) {
  const [params, setParams] = useSearchParams();
  const raw = params.get('date');
  const date = raw && LocalDateSchema.safeParse(raw).success ? raw : today;
  const select = (next: string) => setParams(next === today ? {} : { date: next });
  return { date, select };
}

function Day({ plan, schedule, tasks }: { plan: PlanSummary; schedule: Schedule; tasks: Task[] }) {
  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const { date, select } = useSelectedDate(schedule.today);
  const future = compareDates(date, schedule.today) > 0;
  const shown = future ? schedule.today : date;
  const position = dayOfPlan(plan.startDate, shown, schedule.finishDate);
  return (
    <>
      <p className="text-h2 font-bold">
        {formatDate(shown)}
        <span className="block text-base font-normal text-muted">
          {position ? `Day ${position.day} of ${position.total} · ` : ''}
          {plan.name}
        </span>
      </p>
      <DayPicker date={shown} today={schedule.today} firstDate={plan.startDate} onChange={select} />
      {future ? (
        <p role="status" className="font-bold">
          That day has not arrived yet, so it can’t be opened.{' '}
          <button
            type="button"
            className={`${linkClass} min-h-11`}
            onClick={() => select(schedule.today)}
          >
            Go to today
          </button>
        </p>
      ) : null}
      {shown === schedule.today ? (
        <TodayView plan={plan} schedule={schedule} tasksById={tasksById} />
      ) : (
        <PastDayView planId={plan.id} date={shown} tasksById={tasksById} />
      )}
    </>
  );
}

function TodayView({
  plan,
  schedule,
  tasksById,
}: {
  plan: PlanSummary;
  schedule: Schedule;
  tasksById: Map<string, Task>;
}) {
  const titleOf = (id: string) => tasksById.get(id)?.title ?? id;
  const day = useDay(plan.id, schedule.today);
  const progress = useProgress(plan.id);
  const logs = useLogs(plan.id, schedule.today, schedule.today);
  const complete = useTaskAction(plan.id, 'complete');
  const skip = useTaskAction(plan.id, 'skip');
  const reopen = useTaskAction(plan.id, 'reopen');
  const [notice, setNotice] = useState<Notice | null>(null);
  // The button that was pressed may be gone after the action (the block shrinks or disappears),
  // so focus moves to the result message instead of falling back to the top of the page.
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);
  // Tasks whose logged hours reached the estimate. They stay a question until the person answers.
  const [suggested, setSuggested] = useState<string[]>([]);

  const todays = schedule.blocks.filter((b) => b.date === schedule.today);
  // Tasks worked on today that no longer have a block (finished, or nothing left to schedule).
  const scheduledIds = new Set(todays.map((b) => b.taskId));
  const workedOn = [...new Set((logs.data?.logs ?? []).map((l) => l.taskId))]
    .filter((id) => !scheduledIds.has(id))
    .flatMap((id) => {
      const task = tasksById.get(id);
      return task ? [task] : [];
    });
  const loggedToday = (id: string) =>
    (logs.data?.logs ?? []).filter((l) => l.taskId === id).reduce((sum, l) => sum + l.hours, 0);

  function act(
    mutation: typeof complete,
    task: Task,
    success: string,
    failure: string,
    undo: boolean,
  ) {
    setNotice(null);
    mutation.mutate(task.id, {
      onSuccess: () => {
        setSuggested((ids) => ids.filter((id) => id !== task.id));
        setNotice({ tone: 'ok', text: success, ...(undo ? { undoTaskId: task.id } : {}) });
      },
      onError: (error) => setNotice({ tone: 'error', text: describeError(error, failure) }),
    });
  }

  function reopenTask(task: Task) {
    act(reopen, task, `Reopened ${task.title}.`, 'Could not reopen the task.', false);
  }

  function onLogged(result: LogResult) {
    const { task, log, suggestDone } = result;
    setNotice({
      tone: 'ok',
      text: `Logged ${formatHours(log.hours)} on ${task.title}. ${formatHours(task.doneHours)} of ${formatHours(task.estHours)} done.`,
    });
    if (suggestDone) setSuggested((ids) => (ids.includes(task.id) ? ids : [...ids, task.id]));
  }

  const busyId =
    (complete.isPending && complete.variables) ||
    (skip.isPending && skip.variables) ||
    (reopen.isPending && reopen.variables) ||
    null;

  return (
    <>
      <QueryView query={day} label="Loading the day…">
        {(state) => (
          <>
            <DayControls planId={plan.id} date={schedule.today} day={state} />
            <QueryView query={progress} label="Loading today’s hours…">
              {(p) => (
                <DayHoursSummary
                  label="Today’s hours"
                  hours={dayHours(
                    schedule.blocks,
                    schedule.today,
                    p.byDay.find((d) => d.date === schedule.today)?.hours ?? 0,
                    state.frozen !== null,
                  )}
                />
              )}
            </QueryView>
          </>
        )}
      </QueryView>

      <WarningsNotice
        warnings={schedule.warnings.filter((w) => w.kind !== 'anchor_at_risk')}
        titleOf={titleOf}
      />

      <section aria-labelledby="today-heading" className="space-y-3">
        <h2 id="today-heading">Today’s blocks</h2>
        <div ref={noticeRef} tabIndex={-1} aria-live="polite" aria-atomic="true">
          {notice?.tone === 'ok' ? (
            <p role="status" className="flex flex-wrap items-center gap-3 font-bold text-ok">
              <span>{notice.text}</span>
              {notice.undoTaskId ? (
                <Button
                  onClick={() => {
                    const task = tasksById.get(notice.undoTaskId!);
                    if (task) reopenTask(task);
                  }}
                >
                  Undo
                </Button>
              ) : null}
            </p>
          ) : null}
          {notice?.tone === 'error' ? <ErrorText>{notice.text}</ErrorText> : null}
        </div>

        {suggested.map((id) => {
          const task = tasksById.get(id);
          if (!task || task.status === 'done') return null;
          return (
            <div
              key={id}
              role="group"
              aria-label={`Estimate reached: ${task.title}`}
              className="space-y-2 rounded-md border border-accent bg-accent-soft p-4 text-accent-soft-text"
            >
              <p>
                <strong>{task.title}</strong>
                <br />
                You've reached the estimate. Mark as done?
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="primary"
                  disabled={complete.isPending}
                  onClick={() =>
                    act(
                      complete,
                      task,
                      `Marked ${task.title} as done.`,
                      'Could not mark the task as done.',
                      true,
                    )
                  }
                >
                  Mark as done
                </Button>
                <Button onClick={() => setSuggested((ids) => ids.filter((x) => x !== id))}>
                  Not yet
                </Button>
              </div>
            </div>
          );
        })}

        {todays.length === 0 && workedOn.length === 0 ? (
          <p className="text-muted">Nothing is scheduled for today.</p>
        ) : (
          <ul className="space-y-3">
            {todays.map((block) => {
              const task = tasksById.get(block.taskId);
              if (!task) return null;
              return (
                <BlockItem
                  key={`${block.taskId}-${block.start}`}
                  planId={plan.id}
                  block={block}
                  task={task}
                  today={schedule.today}
                  busy={busyId === task.id}
                  onLogged={onLogged}
                  onDone={() =>
                    act(
                      complete,
                      task,
                      `Marked ${task.title} as done.`,
                      'Could not mark the task as done.',
                      true,
                    )
                  }
                  onSkip={() =>
                    act(skip, task, `Skipped ${task.title}.`, 'Could not skip the task.', true)
                  }
                  onReopen={() => reopenTask(task)}
                />
              );
            })}
          </ul>
        )}
      </section>

      {workedOn.length > 0 ? (
        <section aria-labelledby="worked-heading" className="space-y-3">
          <h2 id="worked-heading">Worked on today</h2>
          <ul className="space-y-3">
            {workedOn.map((task) => (
              <li
                key={task.id}
                className={`space-y-1 rounded-md border border-l-4 border-border bg-surface p-4 ${TASK_TYPE_META[task.type].strip}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <TaskTypeChip type={task.type} />
                  <TaskStatusLabel status={task.status} />
                </div>
                <h3 className="text-lg font-bold">{task.title}</h3>
                <p className="text-muted tabular-nums">
                  Today {formatHours(loggedToday(task.id))} · Estimated {formatHours(task.estHours)}{' '}
                  · Actual {formatHours(task.doneHours)}
                </p>
                {task.status === 'done' || task.status === 'skipped' ? (
                  <Button onClick={() => reopenTask(task)} disabled={busyId === task.id}>
                    Reopen<span className="sr-only">: {task.title}</span>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <UpcomingDays blocks={schedule.blocks} today={schedule.today} tasksById={tasksById} />
    </>
  );
}
