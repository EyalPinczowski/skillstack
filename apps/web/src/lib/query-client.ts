import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isApiError } from '../api/errors';
import { meKey } from '../api/hooks';

export function createQueryClient() {
  // The server refuses every data call with 403 `terms_not_accepted` until the current Terms and
  // Privacy Policy are accepted (for example, they were updated while this tab was open). Reload
  // the account: GET /me then reports what is missing, and the route guard shows the Terms screen.
  const onError = (error: unknown) => {
    if (isApiError(error) && error.status === 403 && error.code === 'terms_not_accepted') {
      void queryClient.invalidateQueries({ queryKey: meKey });
    }
  };
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      // Failures are shown with a Retry button instead of silently retried in the background.
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });
  return queryClient;
}
