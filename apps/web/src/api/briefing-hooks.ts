import { useQuery } from '@tanstack/react-query';
import { unwrap } from './client';
import { useApi } from './context';
import type { paths } from './schema';

/**
 * Data hooks of the day briefing screen (spec 3.2). They sit next to `hooks.ts` and use the
 * client's generic `raw` handle, so the shared client file stays untouched.
 */
type JsonOf<T> = T extends { responses: { 200: { content: { 'application/json': infer B } } } }
  ? B
  : never;

export type Briefing = JsonOf<paths['/api/v1/plans/{planId}/days/{date}/briefing']['get']>;
export type BriefingTask = Briefing['tasks'][number];

export const briefingKey = (planId: string, date: string) => ['briefing', planId, date] as const;

export function useBriefing(planId: string | undefined, date: string) {
  const api = useApi();
  return useQuery({
    queryKey: briefingKey(planId ?? '', date),
    queryFn: ({ signal }) =>
      unwrap(
        api.raw.GET('/api/v1/plans/{planId}/days/{date}/briefing', {
          params: { path: { planId: planId!, date } },
          signal,
        }),
      ),
    enabled: !!planId,
  });
}
