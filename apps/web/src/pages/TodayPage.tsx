import { ApiStatus } from '../components/ApiStatus';

/** The signed-in home. The plan builder and dashboard replace the empty state in later branches. */
export function TodayPage({ apiUrl }: { apiUrl: string }) {
  return (
    <div className="space-y-6">
      <h1>Today</h1>
      <section
        aria-labelledby="empty-heading"
        className="space-y-1 rounded-md border border-border bg-surface p-4"
      >
        <h2 id="empty-heading">No plan yet</h2>
        <p className="text-muted">When you start a study plan, today’s tasks will show up here.</p>
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
