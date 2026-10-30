import { useEffect, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { isApiError } from '../api/errors';
import { useMe } from '../api/hooks';
import { Loading, ServerProblem } from '../components/status';
import type { AppEnv } from '../env';
import { PublicShell } from '../layout/Shell';
import { useAuth } from './AuthProvider';
import { ForbiddenScreen } from './ForbiddenScreen';
import { TermsGate } from './TermsGate';

/**
 * The route guard for everything that needs an account, in this order:
 * signed out -> sign-in page; GET /me refused (403) -> the generic message; Terms not accepted ->
 * the acceptance screen; only then the app. Nothing of the app renders before all four pass.
 */
export function RequireAccount({ appEnv }: { appEnv: AppEnv }) {
  const { state } = useAuth();
  const location = useLocation();
  const gate = (content: ReactNode) => <PublicShell appEnv={appEnv}>{content}</PublicShell>;

  if (state.status === 'loading') return gate(<Loading label="Checking your sign-in…" />);
  if (state.status === 'signedOut') {
    return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  }
  return <AccountGate appEnv={appEnv} />;
}

/** Only mounted while signed in, so GET /me is never sent without a session. */
function AccountGate({ appEnv }: { appEnv: AppEnv }) {
  const { signOut } = useAuth();
  const me = useMe();
  const gate = (content: ReactNode) => <PublicShell appEnv={appEnv}>{content}</PublicShell>;

  const unauthorized = me.isError && isApiError(me.error) && me.error.status === 401;
  useEffect(() => {
    // The server no longer accepts this session: end it here too, which shows the sign-in page.
    if (unauthorized) void signOut('local').catch(() => undefined);
  }, [unauthorized, signOut]);

  if (me.data) {
    if (!me.data.legal.allAccepted) return gate(<TermsGate me={me.data} />);
    return <Outlet />;
  }

  // TanStack Query waits for the network when the browser is offline: say so instead of spinning.
  if (me.fetchStatus === 'paused') {
    return gate(<ServerProblem offline onRetry={() => void me.refetch()} />);
  }

  if (me.isError && !me.isFetching) {
    if (isApiError(me.error) && me.error.status === 403) return gate(<ForbiddenScreen />);
    if (unauthorized) return gate(<Loading label="Signing you out…" />);
    return gate(<ServerProblem error={me.error} onRetry={() => void me.refetch()} />);
  }

  return gate(<Loading label="Loading your account…" />);
}
