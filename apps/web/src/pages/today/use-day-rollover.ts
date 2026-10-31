import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { Schedule } from '../../api/client';
import { progressKey, scheduleKey, tasksKey } from '../../api/hooks';
import { dateInZone, msUntilMidnight } from '../../lib/zoned-date';

/** A little after midnight, so the timer never fires just before it and finds the old date. */
const MARGIN_MS = 250;

/**
 * Keeps "today" right on a screen that stays open (v0.1 review finding 8). The server works out
 * today in the plan's time zone, so the schedule that is on screen is only correct for the day
 * it was fetched. When the plan's local date has moved on since then, whether noticed by a timer
 * set for the next local midnight or on return to the window (a sleeping tablet runs no timers),
 * the schedule is dropped and fetched again. Dropped, not just marked old: until the new one
 * arrives the page shows "Loading", so nothing can be logged against yesterday's date.
 */
export function useDayRollover(planId: string, schedule: UseQueryResult<Schedule>) {
  const queryClient = useQueryClient();
  const timezone = schedule.data?.timezone;
  // The latest fetch time, read when the timer or an event fires without restarting them.
  const fetchedAt = useRef(schedule.dataUpdatedAt);
  const dataUpdatedAt = schedule.dataUpdatedAt;
  useEffect(() => {
    fetchedAt.current = dataUpdatedAt;
  }, [dataUpdatedAt]);

  useEffect(() => {
    if (!timezone) return;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = () => {
      const today = dateInZone(Date.now(), timezone);
      const fetchedDay = dateInZone(fetchedAt.current, timezone);
      if (!today || !fetchedDay || today <= fetchedDay) return;
      void queryClient.resetQueries({ queryKey: scheduleKey(planId), exact: true });
      void queryClient.invalidateQueries({ queryKey: tasksKey(planId) });
      void queryClient.invalidateQueries({ queryKey: progressKey(planId) });
    };

    const arm = () => {
      clearTimeout(timer);
      const wait = msUntilMidnight(Date.now(), timezone);
      if (wait === null) return;
      timer = setTimeout(() => {
        check();
        arm();
      }, wait + MARGIN_MS);
    };

    const onReturn = () => {
      if (document.visibilityState === 'hidden') return;
      check();
      arm();
    };

    arm();
    check(); // The page may be opened from a cache that is already a day old.
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [planId, timezone, queryClient]);
}
