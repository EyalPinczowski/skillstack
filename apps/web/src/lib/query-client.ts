import { QueryClient } from '@tanstack/react-query';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      // Failures are shown with a Retry button instead of silently retried in the background.
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });
}
