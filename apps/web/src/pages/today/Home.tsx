import { useEffect, useMemo, useRef, useState } from 'react';
import type { LogResult, PlanSummary, Schedule, Task } from '../../api/client';
import { useSchedule, useTaskAction, useTasks } from '../../api/hooks';
import { QueryView } from '../../components/QueryView';
import { Button, ErrorText } from '../../components/ui';
import { dayOfPlan, formatDate, formatHours } from '../../lib/format';
import { describeError } from '../../lib/messages';
import { PlanSwitcher } from '../../plan/PlanGate';
import { BlockItem } from './BlockItem';
import { ProgressSummary } from './ProgressSummary';
import { UpcomingDays } from './UpcomingDays';
import { WarningsNotice } from './WarningsNotice';

type Notice = { tone: 'ok'; text: string; undoTaskId?: string } | { tone: 'error'; text: string };

/** The day: date, progress, warnings, today's blocks and what comes next. */
export function Home({ plan }: { plan: PlanSummary }) {
  const schedule = useSchedule(plan.id);
  const tasks = useTasks(plan.id);
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

function Day({ plan, schedule, tasks }: { plan: PlanSummary; schedule: Schedule; tasks: Task[] }) {
  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const titleOf = (id: string) => tasksById.get(id)?.title ?? id;
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
  const position = dayOfPlan(plan.startDate, schedule.today, schedule.finishDate);
  const plannedCertificates = tasks.filter((t) => t.isCertificate).length;

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

  function onLogged(result: LogResult) {
    const { task, log, suggestDone } = result;
    setNotice({
      tone: 'ok',
      text: `Logged ${formatHours(log.hours)} on ${task.title}. ${formatHours(task.doneHours)} of ${formatHours(task.estHours)} done.`,
    });
    if (suggestDone) setSuggested((ids) => (ids.includes(task.id) ? ids : [...ids, task.id]));
  }

  const busyId =
    (complete.isPending && complete.variables) || (skip.isPending && skip.variables) || null;

  return (
    <>
      <p className="text-h2 font-bold">
        {formatDate(schedule.today)}
        <span className="block text-base font-normal text-muted">
          {position ? `Day ${position.day} of ${position.total} · ` : ''}
          {plan.name}
        </span>
      </p>

      <WarningsNotice warnings={schedule.warnings} titleOf={titleOf} />

      <ProgressSummary
        planId={plan.id}
        finishDate={schedule.finishDate}
        plannedCertificates={plannedCertificates}
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
                    if (task) {
                      act(
                        reopen,
                        task,
                        `Reopened ${task.title}.`,
                        'Could not reopen the task.',
                        false,
                      );
                    }
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

        {todays.length === 0 ? (
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
                />
              );
            })}
          </ul>
        )}
      </section>

      <UpcomingDays blocks={schedule.blocks} today={schedule.today} tasksById={tasksById} />
    </>
  );
}
