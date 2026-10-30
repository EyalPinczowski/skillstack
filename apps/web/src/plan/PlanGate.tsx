import type { ReactNode } from 'react';
import type { PlanSummary } from '../api/client';
import { QueryView } from '../components/QueryView';
import { useActivePlan } from './context';

/** Waits for the plan list, then renders `children` for the open plan or `empty` when there is none. */
export function PlanGate({
  empty,
  children,
}: {
  empty: ReactNode;
  children: (plan: PlanSummary) => ReactNode;
}) {
  const { query, plan } = useActivePlan();
  return (
    <QueryView query={query} label="Loading your plan…">
      {() => (plan ? children(plan) : empty)}
    </QueryView>
  );
}

/** A plain select, shown only when there is more than one plan. */
export function PlanSwitcher() {
  const { plans, plan, select } = useActivePlan();
  if (plans.length < 2 || !plan) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="plan-switcher" className="font-bold">
        Plan
      </label>
      <select
        id="plan-switcher"
        value={plan.id}
        onChange={(event) => select(event.target.value)}
        className="min-h-11 min-w-0 max-w-full rounded-sm border border-border bg-surface px-3 py-2 text-text"
      >
        {plans.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}
