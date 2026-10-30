import { useRef, useState, type FormEvent } from 'react';
import type { LogResult, Task } from '../../api/client';
import { useAddLog } from '../../api/hooks';
import { Button, ErrorText, TextField } from '../../components/ui';
import { describeError, newId } from '../../lib/messages';

/**
 * Log hours worked on a task. The log id is made on the first try and kept for a retry of the same
 * entry, so a lost connection cannot record the time twice. Nothing here closes the task.
 */
export function LogTimeForm({
  planId,
  task,
  date,
  defaultHours,
  onLogged,
  onCancel,
}: {
  planId: string;
  task: Task;
  /** The local date to log against: the schedule's "today". */
  date: string;
  defaultHours: number;
  onLogged: (result: LogResult) => void;
  onCancel: () => void;
}) {
  const addLog = useAddLog(planId);
  const [hours, setHours] = useState(String(Number(defaultHours.toFixed(2))));
  const [note, setNote] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const attempt = useRef<{ key: string; id: string } | null>(null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const value = Number(hours);
    if (hours.trim() === '' || !Number.isFinite(value) || value <= 0 || value > 24) {
      setFieldError('Enter the hours as a number above 0 and up to 24.');
      return;
    }
    setFieldError(null);
    const trimmed = note.trim();
    const key = `${value}|${trimmed}`;
    if (attempt.current?.key !== key) attempt.current = { key, id: newId() };
    addLog.mutate(
      {
        taskId: task.id,
        log: { id: attempt.current.id, date, hours: value, ...(trimmed ? { note: trimmed } : {}) },
      },
      {
        onSuccess: (result) => {
          attempt.current = null;
          onLogged(result);
        },
      },
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3 border-t border-border pt-3">
      <TextField
        label="Hours"
        type="number"
        inputMode="decimal"
        step="0.25"
        min="0"
        max="24"
        value={hours}
        onChange={(event) => setHours(event.target.value)}
        error={fieldError}
        className="max-w-40"
      />
      <TextField
        label="Note (optional)"
        value={note}
        maxLength={5000}
        onChange={(event) => setNote(event.target.value)}
      />
      {addLog.isError ? (
        <ErrorText>{describeError(addLog.error, 'The time could not be logged.')}</ErrorText>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="primary" disabled={addLog.isPending}>
          {addLog.isPending ? 'Logging…' : 'Log time'}
        </Button>
        <Button onClick={onCancel} disabled={addLog.isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
