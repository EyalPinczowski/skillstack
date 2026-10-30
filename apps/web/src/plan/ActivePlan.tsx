import { useCallback, useMemo, useState } from 'react';
import { Outlet } from 'react-router';
import { usePlans } from '../api/hooks';
import { ActivePlanContext } from './context';

const STORAGE_KEY = 'skillstack.plan';

// Browser storage is only a per-device convenience; it can be blocked or empty.
function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(planId: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, planId);
  } catch {
    // Not remembering the choice is fine.
  }
}

/** Loads the person's plans once and tells every page which one is open (v0.1: no more than a select). */
export function ActivePlanProvider() {
  const query = usePlans();
  const [chosen, setChosen] = useState<string | null>(readStored);
  const plans = useMemo(() => query.data?.plans ?? [], [query.data]);
  const plan = plans.find((p) => p.id === chosen) ?? plans[0];

  const select = useCallback((planId: string) => {
    setChosen(planId);
    writeStored(planId);
  }, []);

  const value = useMemo(() => ({ query, plans, plan, select }), [query, plans, plan, select]);
  return (
    <ActivePlanContext value={value}>
      <Outlet />
    </ActivePlanContext>
  );
}
