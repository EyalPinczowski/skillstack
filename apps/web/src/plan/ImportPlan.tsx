import { useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import demoPlanText from '../../../../data/sample-plans/demo-plan.json?raw';
import type { ImportBody } from '../api/client';
import { isApiError } from '../api/errors';
import { useImportPlan } from '../api/hooks';
import { AlertIcon } from '../components/icons';
import { Button, TextAreaField } from '../components/ui';
import { describeError, isConnectionProblem, newId } from '../lib/messages';
import { useActivePlan } from './context';

/** Splits the API's "Invalid plan file. a: b; c: d" message into a lead sentence and its issues. */
function readableIssues(message: string): { lead: string; issues: string[] } {
  const marker = 'Invalid plan file. ';
  if (!message.startsWith(marker)) return { lead: message, issues: [] };
  return { lead: 'The plan file is not valid.', issues: message.slice(marker.length).split('; ') };
}

function Problem({ lead, issues }: { lead: string; issues: string[] }) {
  return (
    <div role="alert" className="space-y-1 text-warn">
      <p className="flex items-start gap-2 font-bold">
        <AlertIcon />
        <span>{lead}</span>
      </p>
      {issues.length ? (
        <ul className="list-disc space-y-1 pl-12 text-text">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type Parsed = { ok: true; body: Record<string, unknown> } | { ok: false; message: string };

function parsePlanText(text: string): Parsed {
  if (text.trim() === '')
    return { ok: false, message: 'Paste a plan or choose a plan file first.' };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, message: 'That is not valid JSON. Check the file and try again.' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, message: 'A plan file is a JSON object, like {"formatVersion": 1, ...}.' };
  }
  return { ok: true, body: value as Record<string, unknown> };
}

/**
 * The empty state: bring a plan file in. The plan id is generated here and kept while the same
 * text is retried, so a lost connection never creates a second plan. The API checks the plan.
 */
export function ImportPlan() {
  const { select } = useActivePlan();
  const importPlan = useImportPlan();
  const [text, setText] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  // The id that goes with the text last sent; reused for a retry of the same text.
  const attempt = useRef<{ text: string; id: string } | null>(null);
  const fileId = useId();

  function send(planText: string) {
    const parsed = parsePlanText(planText);
    if (!parsed.ok) {
      setLocalError(parsed.message);
      return;
    }
    setLocalError(null);
    if (attempt.current?.text !== planText) attempt.current = { text: planText, id: newId() };
    const body: ImportBody = { ...parsed.body, id: attempt.current.id };
    importPlan.mutate(body, {
      onSuccess: (plan) => {
        attempt.current = null;
        select(plan.id);
      },
      onError: (error) => {
        // A conflict means this id is taken by other content: the next try gets a fresh id.
        if (isApiError(error) && error.status === 409) attempt.current = null;
      },
    });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    send(text);
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setText(await file.text());
      setFileNote(`Loaded ${file.name}. Check it, then choose Import plan.`);
      setLocalError(null);
      importPlan.reset();
    } catch {
      setFileNote(null);
      setLocalError('That file could not be read.');
    }
  }

  const error = importPlan.error;
  const message = error ? describeError(error, 'The plan could not be imported.') : null;
  const issues = message ? readableIssues(message) : null;
  const conflict = isApiError(error) && error.status === 409;

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <div className="space-y-1">
          <label htmlFor={fileId} className="block font-bold">
            Plan file
          </label>
          <input
            id={fileId}
            type="file"
            accept=".json,application/json"
            onChange={(event) => void onFile(event)}
            className="block min-h-11 w-full text-text file:mr-3 file:min-h-11 file:rounded-sm file:border file:border-border file:bg-surface-2 file:px-4 file:font-bold file:text-text"
          />
          {fileNote ? (
            <p role="status" className="text-muted">
              {fileNote}
            </p>
          ) : null}
        </div>
        <TextAreaField
          label="Or paste the plan JSON"
          rows={8}
          spellCheck={false}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setFileNote(null);
            setLocalError(null);
          }}
          className="font-mono text-sm"
          error={localError}
        />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="primary" disabled={importPlan.isPending}>
            {importPlan.isPending ? 'Importing…' : 'Import plan'}
          </Button>
        </div>
      </form>

      {issues ? <Problem lead={issues.lead} issues={issues.issues} /> : null}
      {error && isConnectionProblem(error) ? (
        <p className="text-muted">Trying again is safe: the same plan is not added twice.</p>
      ) : null}
      {conflict ? (
        <p className="text-muted">Nothing was changed. Choose Import plan to try again.</p>
      ) : null}

      <div className="space-y-2 border-t border-border pt-4">
        <p className="text-muted">No plan file yet? Try the app with a fictional sample plan.</p>
        <Button
          disabled={importPlan.isPending}
          onClick={() => {
            setText(demoPlanText);
            setLocalError(null);
            send(demoPlanText);
          }}
        >
          Load the demo plan
        </Button>
      </div>
    </div>
  );
}
