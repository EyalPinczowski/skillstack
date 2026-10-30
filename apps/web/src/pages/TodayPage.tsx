import { ApiStatus } from '../components/ApiStatus';
import { ImportPlan } from '../plan/ImportPlan';
import { PlanGate } from '../plan/PlanGate';
import { Home } from './today/Home';

function EmptyState({ apiUrl }: { apiUrl: string }) {
  return (
    <div className="space-y-6">
      <h1>Today</h1>
      <section
        aria-labelledby="empty-heading"
        className="space-y-3 rounded-md border border-border bg-surface p-4"
      >
        <div className="space-y-1">
          <h2 id="empty-heading">No plan yet</h2>
          <p className="text-muted">
            Bring in a plan file and today’s tasks will show up here. Plan changes are always
            suggestions until you approve them.
          </p>
        </div>
        <ImportPlan />
      </section>
      <section
        aria-labelledby="server-heading"
        className="rounded-md border border-border bg-surface p-4"
      >
        <h2 id="server-heading" className="mb-1">
          Server
        </h2>
        <ApiStatus apiUrl={apiUrl} />
      </section>
    </div>
  );
}

/** The signed-in home: the import form when there is no plan yet, otherwise the day. */
export function TodayPage({ apiUrl }: { apiUrl: string }) {
  return (
    <PlanGate empty={<EmptyState apiUrl={apiUrl} />}>{(plan) => <Home plan={plan} />}</PlanGate>
  );
}
