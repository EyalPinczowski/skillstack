import { APP_NAME, APP_TAGLINE } from '@skillstack/shared';
import { ApiStatus } from './ApiStatus';

export function Home({ apiUrl }: { apiUrl: string }) {
  return (
    <div className="space-y-6">
      <div>
        <h1>{APP_NAME}</h1>
        <p className="text-muted first-letter:uppercase">{APP_TAGLINE}</p>
      </div>
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
