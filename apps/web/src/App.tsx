import { APP_NAME } from '@skillstack/shared';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { DemoBanner, EnvironmentBadge } from './components/EnvironmentBadge';
import { Home } from './components/Home';
import { Logo } from './components/Logo';
import type { Env } from './env';

export function App({ env, queryClient }: { env: Env; queryClient: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <a
        href="#main"
        className="sr-only rounded-sm bg-accent px-4 py-3 font-bold text-on-accent focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-10"
      >
        Skip to main content
      </a>
      <DemoBanner appEnv={env.appEnv} />
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex min-h-16 max-w-3xl items-center gap-3 px-4">
          <Logo title={null} />
          <span className="text-h2 font-bold">{APP_NAME}</span>
          <span className="ml-auto">
            <EnvironmentBadge appEnv={env.appEnv} />
          </span>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-6">
        <Home apiUrl={env.apiUrl} />
      </main>
    </QueryClientProvider>
  );
}
