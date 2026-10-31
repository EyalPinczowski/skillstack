import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from './client';
import { useApi } from './context';
import { planKey, plansKey, progressKey, scheduleKey, tasksKey } from './hooks';
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
export type DayState = JsonOf<paths['/api/v1/plans/{planId}/days/{date}']['get']>;

export const briefingKey = (planId: string, date: string) => ['briefing', planId, date] as const;
export const dayStateKey = (planId: string, date: string) => ['day-state', planId, date] as const;

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

/** Whether the day was started or ended, and its frozen blocks. */
export function useDayState(planId: string | undefined, date: string) {
  const api = useApi();
  return useQuery({
    queryKey: dayStateKey(planId ?? '', date),
    queryFn: ({ signal }) =>
      unwrap(
        api.raw.GET('/api/v1/plans/{planId}/days/{date}', {
          params: { path: { planId: planId!, date } },
          signal,
        }),
      ),
    enabled: !!planId,
  });
}

/** Starts the study day (idempotent on the server). An explicit action; never called on its own. */
export function useStartDay(planId: string, date: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: () =>
      unwrap(
        api.raw.POST('/api/v1/plans/{planId}/days/{date}/start', {
          params: { path: { planId, date } },
        }),
      ),
    onSuccess: (state) => {
      queryClient.setQueryData(dayStateKey(planId, date), state);
      // Today's page reads the schedule, tasks and progress; make them refresh.
      void queryClient.invalidateQueries({ queryKey: scheduleKey(planId) });
      void queryClient.invalidateQueries({ queryKey: tasksKey(planId) });
      void queryClient.invalidateQueries({ queryKey: progressKey(planId) });
      void queryClient.invalidateQueries({ queryKey: planKey(planId) });
      void queryClient.invalidateQueries({ queryKey: plansKey });
    },
  });
}
