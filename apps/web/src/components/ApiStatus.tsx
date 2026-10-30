import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { AlertIcon, CheckIcon, ClockIcon } from './icons';

const SLOW_AFTER_MS = 3000;

const healthSchema = z.object({
  status: z.literal('ok'),
  environment: z.string(),
});

async function fetchHealth(apiUrl: string, signal: AbortSignal) {
  const res = await fetch(`${apiUrl}/api/v1/health`, { signal });
  if (!res.ok) throw new Error(`Health check failed with status ${res.status}`);
  return healthSchema.parse(await res.json());
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

const row = 'flex min-h-11 items-center gap-2';

export function ApiStatus({ apiUrl }: { apiUrl: string }) {
  const query = useQuery({
    queryKey: ['health', apiUrl],
    queryFn: ({ signal }) => fetchHealth(apiUrl, signal),
  });

  if (query.isError) {
    return (
      <div role="alert" className={`${row} flex-wrap text-warn`}>
        <AlertIcon />
        <span className="font-bold">Can’t reach the server.</span>
        <button
          type="button"
          onClick={() => void query.refetch()}
          className="min-h-11 min-w-11 rounded-sm border border-border bg-surface-2 px-4 font-bold text-text hover:border-accent"
        >
          Retry
        </button>
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
