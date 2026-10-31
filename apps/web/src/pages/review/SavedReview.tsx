import { useRef, useState } from 'react';
import { useAddLog, useTaskAction } from '../../api/hooks';
import type { ReviewResult } from '../../api/review-hooks';
import { Button, ErrorText } from '../../components/ui';
import { CheckIcon } from '../../components/icons';
import { formatHours } from '../../lib/format';
import { describeError, newId } from '../../lib/messages';

type Missing = ReviewResult['missingLogs'][number];

function MissingLogRow({
  planId,
  date,
  item,
  title,
}: {
  planId: string;
  date: string;
  item: Missing;
  title: string;
}) {
  const addLog = useAddLog(planId);
  const [logged, setLogged] = useState(false);
  // One id per attempt: a retry after a lost connection cannot record the time twice.
  const attempt = useRef<string | null>(null);
  return (
    <li className="space-y-2">
      <p>
        <strong>{title}</strong>: reported {formatHours(item.reportedHours)}, logged{' '}
        {formatHours(item.loggedHours)}, not logged yet {formatHours(item.missingHours)}.
      </p>
      {logged ? (
        <p role="status" className="flex items-center gap-2 font-bold text-ok">
          <CheckIcon />
          Logged {formatHours(item.missingHours)} on {title}
        </p>
      ) : (
        <Button
          disabled={addLog.isPending}
          onClick={() => {
            attempt.current ??= newId();
            addLog.mutate(
              {
                taskId: item.taskId,
                log: { id: attempt.current, date, hours: item.missingHours },
              },
              {
                onSuccess: () => {
                  attempt.current = null;
                  setLogged(true);
                },
              },
            );
          }}
        >
          {addLog.isPending ? 'Logging…' : 'Log these hours'}
          <span className="sr-only">
            : {formatHours(item.missingHours)} on {title}
          </span>
        </Button>
      )}
      {addLog.isError ? (
        <ErrorText>{describeError(addLog.error, 'The hours could not be logged.')}</ErrorText>
      ) : null}
    </li>
  );
}

function NotMarkedDoneRow({
  planId,
  taskId,
  title,
}: {
  planId: string;
  taskId: string;
  title: string;
}) {
  const complete = useTaskAction(planId, 'complete');
  return (
    <li className="space-y-2">
      <p>
        <strong>{title}</strong> is not marked as done yet.
      </p>
      {complete.isSuccess ? (
        <p role="status" className="flex items-center gap-2 font-bold text-ok">
          <CheckIcon />
          Marked {title} as done
        </p>
      ) : (
        <Button disabled={complete.isPending} onClick={() => complete.mutate(taskId)}>
          {complete.isPending ? 'Saving…' : 'Mark done'}
          <span className="sr-only">: {title}</span>
        </Button>
      )}
      {complete.isError ? (
        <ErrorText>
          {describeError(complete.error, 'The task could not be marked as done.')}
        </ErrorText>
      ) : null}
    </li>
  );
}

/**
 * What the saved review leaves open. Logging hours and marking a task done are separate, explicit
 * buttons: the review itself never does either.
 */
export function SavedReview({
  planId,
  date,
  result,
  titleOf,
}: {
  planId: string;
  date: string;
  result: ReviewResult;
  titleOf: (taskId: string) => string;
}) {
  const open = result.missingLogs.length + result.notMarkedDone.length;
  return (
    <section
      aria-labelledby="saved-heading"
      className="space-y-4 rounded-md border border-ok bg-ok-soft p-4"
    >
      <h2 id="saved-heading" className="flex items-center gap-2 text-ok">
        <CheckIcon />
        {result.created ? 'Review saved' : 'Review updated'}
      </h2>
      <div role="status">
        <p>
          {open === 0
            ? 'Nothing else needs your attention for this day.'
            : 'The review did not log any hours or mark any task as done. You decide on the items below.'}
        </p>
      </div>
      {result.missingLogs.length > 0 ? (
        <div className="space-y-2">
          <h3 className="font-bold">Hours you reported but have not logged</h3>
          <ul className="space-y-4">
            {result.missingLogs.map((item) => (
              <MissingLogRow
                key={item.taskId}
                planId={planId}
                date={date}
                item={item}
                title={titleOf(item.taskId)}
              />
            ))}
          </ul>
        </div>
      ) : null}
      {result.notMarkedDone.length > 0 ? (
        <div className="space-y-2">
          <h3 className="font-bold">Tasks you said are done</h3>
          <ul className="space-y-4">
            {result.notMarkedDone.map((taskId) => (
              <NotMarkedDoneRow
                key={taskId}
                planId={planId}
                taskId={taskId}
                title={titleOf(taskId)}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
