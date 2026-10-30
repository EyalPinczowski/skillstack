import { useEffect, useState } from 'react';
import { isApiError } from '../api/errors';
import { AlertIcon, ClockIcon } from './icons';

const SLOW_AFTER_MS = 3000;

/**
 * Mounted only while a request is pending, so its timer restarts on every retry. After 3 seconds
 * it explains the free-plan cold start instead of leaving the person guessing.
 */
export function PendingMessage({ label }: { label: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  return slow ? 'Waking up the server… this can take up to a minute on the free plan' : label;
}

export function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-11 min-w-11 rounded-sm border border-border bg-surface-2 px-4 font-bold text-text hover:border-accent"
    >
      Retry
    </button>
  );
}

const row = 'flex min-h-11 items-center gap-2';

/** A pending request: status text with the "waking up" explanation after a few seconds. */
export function Loading({ label }: { label: string }) {
  return (
    <p role="status" className={`${row} text-muted`}>
      <ClockIcon />
      <PendingMessage label={label} />
    </p>
  );
}

/** What went wrong with a server request, in words, with Retry. Never shows raw error text. */
export function ServerProblem({
  error,
  offline = false,
  onRetry,
}: {
  error?: unknown;
  /** True while the browser is offline and TanStack Query is waiting to run the request. */
  offline?: boolean;
  onRetry: () => void;
}) {
  if (offline) {
    return (
      <div role="status" className={`${row} flex-wrap text-warn`}>
        <AlertIcon />
        <span className="font-bold">You're offline. Reconnect to continue.</span>
        <RetryButton onClick={onRetry} />
      </div>
    );
  }
  const serverSide = isApiError(error) && error.kind === 'http';
  return (
    <div role="alert" className={`${row} flex-wrap text-warn`}>
      <AlertIcon />
      <span className="font-bold">
        {serverSide ? 'Something went wrong on our side.' : 'Can’t reach the server.'}
      </span>
      <RetryButton onClick={onRetry} />
    </div>
  );
}
