import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Loading, ServerProblem } from './status';

/** Shows the loading, offline or error state of a query, and the content once it has data. */
export function QueryView<T>({
  query,
  label,
  children,
}: {
  query: UseQueryResult<T>;
  /** Status text while loading, e.g. "Loading your schedule…". */
  label: string;
  children: (data: T) => ReactNode;
}) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.isError && !query.isFetching) {
    return <ServerProblem error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (query.isPending && query.fetchStatus === 'paused') {
    return <ServerProblem offline onRetry={() => void query.refetch()} />;
  }
  return <Loading label={label} />;
}
