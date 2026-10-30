import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { AlertIcon, CheckIcon, ClockIcon } from './icons';

const SLOW_AFTER_MS = 3000;

const healthSchema = z.object({
  status: z.literal('ok'),
  environment: z.string(),
});

// Longer than a free-plan cold start, short enough that a dead server ends in an error state.
const TIMEOUT_MS = 60_000;

function combineSignals(signal: AbortSignal, timeout: AbortController): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout.signal]);
  // Safari and iOS before 17.4 have no AbortSignal.any: forward the caller's abort instead.
  if (signal.aborted) timeout.abort(signal.reason);
  else signal.addEventListener('abort', () => timeout.abort(signal.reason), { once: true });
  return timeout.signal;
}

async function fetchHealth(apiUrl: string, signal: AbortSignal) {
  // A timer plus AbortController rather than AbortSignal.timeout, so tests can fake the clock.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new Error('Health check timed out')), TIMEOUT_MS);
  try {
    const res = await fetch(`${apiUrl}/api/v1/health`, {
      signal: combineSignals(signal, timeout),
    });
    if (!res.ok) throw new Error(`Health check failed with status ${res.status}`);
    return healthSchema.parse(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

/** Mounted only while a request is pending, so its timer restarts on every retry. */
function PendingMessage() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  return slow
    ? 'Waking up the server… this can take up to a minute on the free plan'
    : 'Checking the server…';
}

function RetryButton({ onClick }: { onClick: () => void }) {
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

export function ApiStatus({ apiUrl }: { apiUrl: string }) {
  const query = useQuery({
    queryKey: ['health', apiUrl],
    queryFn: ({ signal }) => fetchHealth(apiUrl, signal),
  });

  // While a retry is running the pending row below is shown, not the old error.
  if (query.isError && !query.isFetching) {
    return (
      <div role="alert" className={`${row} flex-wrap text-warn`}>
        <AlertIcon />
        <span className="font-bold">Can’t reach the server.</span>
        <RetryButton onClick={() => void query.refetch()} />
      </div>
    );
  }

  // Paused means TanStack Query is waiting for the browser to come back online.
  if (query.fetchStatus === 'paused') {
    return (
      <div role="status" className={`${row} flex-wrap text-warn`}>
        <AlertIcon />
        <span className="font-bold">You're offline. Reconnect to check the server.</span>
        <RetryButton onClick={() => void query.refetch()} />
      </div>
    );
  }

  if (query.isSuccess) {
    return (
      <p role="status" className={`${row} text-ok`}>
        <CheckIcon />
        <span className="font-bold">
          Connected <span className="font-normal text-muted">· {query.data.environment}</span>
        </span>
      </p>
    );
  }

  return (
    <p role="status" className={`${row} text-muted`}>
      <ClockIcon />
      <PendingMessage />
    </p>
  );
}
