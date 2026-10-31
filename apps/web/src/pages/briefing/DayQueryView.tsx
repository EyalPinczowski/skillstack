import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { isApiError } from '../../api/errors';
import { QueryView } from '../../components/QueryView';
import { AlertIcon } from '../../components/icons';

/** The friendly state for a date the API will not serve (422): a future day or one outside the plan. */
export function DayUnavailable({ what }: { what: 'briefing' | 'review' }) {
  return (
    <section
      aria-labelledby="unavailable-heading"
      className="space-y-2 rounded-md border border-border bg-surface p-4"
    >
      <h2 id="unavailable-heading" className="flex items-center gap-2">
        <AlertIcon />
        Not available for this day
      </h2>
      <p>
        {what === 'briefing'
          ? 'A briefing is ready on the day itself. Days before the plan began or long past are not available.'
          : 'A review can be written on the day itself or later. Days before the plan began are not available.'}
      </p>
    </section>
  );
}

/** QueryView that also shows the friendly "not available" state when the API answers 422. */
export function DayQueryView<T>({
  query,
  label,
  what,
  children,
}: {
  query: UseQueryResult<T>;
  label: string;
  what: 'briefing' | 'review';
  children: (data: T) => ReactNode;
}) {
  if (
    query.data === undefined &&
    query.isError &&
    !query.isFetching &&
    isApiError(query.error) &&
    query.error.status === 422
  ) {
    return <DayUnavailable what={what} />;
  }
  return (
    <QueryView query={query} label={label}>
      {children}
    </QueryView>
  );
}
