import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { combineSignals, REQUEST_TIMEOUT_MS } from '../lib/abort';
import { AlertIcon, CheckIcon, ClockIcon } from './icons';
import { PendingMessage, RetryButton } from './status';

const healthSchema = z.object({
  status: z.literal('ok'),
  environment: z.string(),
});

async function fetchHealth(apiUrl: string, signal: AbortSignal) {
  // A timer plus AbortController rather than AbortSignal.timeout, so tests can fake the clock.
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new Error('Health check timed out')),
    REQUEST_TIMEOUT_MS,
  );
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
      <PendingMessage label="Checking the server…" />
    </p>
  );
}
