import type { UseQueryResult } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import type { PlanSummary } from '../api/client';

export interface ActivePlanValue {
  /** The plan list request: pages show loading and error states from it. */
  query: UseQueryResult<{ plans: PlanSummary[] }>;
  plans: PlanSummary[];
  /** The chosen plan, or the first one; undefined while loading or when there is none. */
  plan: PlanSummary | undefined;
  select: (planId: string) => void;
}

export const ActivePlanContext = createContext<ActivePlanValue | null>(null);

export function useActivePlan(): ActivePlanValue {
  const value = useContext(ActivePlanContext);
  if (!value) throw new Error('useActivePlan must be used inside <ActivePlanProvider>');
  return value;
}
