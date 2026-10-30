import { APP_NAME } from '@skillstack/shared';
import { useEffect, useRef, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { EnvironmentBadge } from '../components/EnvironmentBadge';
import { SettingsIcon, TodayIcon } from '../components/icons';
import { Logo } from '../components/Logo';
import type { AppEnv } from '../env';

/** Moves focus to the page content after a route change, so keyboard and screen reader users start there. */
function useFocusMainOnNavigation() {
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    main.current?.focus();
  }, [pathname]);
  return main;
}

function Header({ appEnv }: { appEnv: AppEnv }) {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex min-h-16 max-w-6xl items-center gap-3 px-4">
        <Logo title={null} />
        <span className="text-h2 font-bold">{APP_NAME}</span>
        <span className="ml-auto">
          <EnvironmentBadge appEnv={appEnv} />
        </span>
      </div>
    </header>
  );
}

/** Signed-out pages: sign-in, legal documents, and the screens shown before the app opens. */
export function PublicShell({ appEnv, children }: { appEnv: AppEnv; children?: ReactNode }) {
  const main = useFocusMainOnNavigation();
  return (
    <>
      <Header appEnv={appEnv} />
      <main ref={main} id="main" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-6">
        {children ?? <Outlet />}
      </main>
    </>
  );
}

const NAV = [
  { to: '/', label: 'Today', end: true, Icon: TodayIcon },
  { to: '/settings', label: 'Settings', end: false, Icon: SettingsIcon },
];

const itemBase = 'flex items-center gap-2 font-bold no-underline';

/** The signed-in app: a tab bar along the bottom of a phone, a side rail from tablet width up. */
export function AppShell({ appEnv }: { appEnv: AppEnv }) {
  const main = useFocusMainOnNavigation();
  return (
    <>
      <Header appEnv={appEnv} />
      <div className="mx-auto flex max-w-6xl">
        <nav
          aria-label="Main"
          className="fixed inset-x-0 bottom-0 z-10 flex overflow-x-auto border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:static md:inset-auto md:block md:w-56 md:shrink-0 md:self-start md:overflow-visible md:border-t-0 md:border-r md:bg-transparent md:p-3 md:pb-3"
        >
          {NAV.map(({ to, label, end, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `${itemBase} min-h-16 min-w-24 shrink-0 grow flex-col justify-center border-t-4 px-3 text-sm md:min-h-11 md:min-w-0 md:flex-row md:justify-start md:rounded-sm md:border-t-0 md:border-l-4 md:px-3 md:py-2 md:text-base ${
                  isActive
                    ? 'border-accent bg-accent-soft text-accent-soft-text'
                    : 'border-transparent text-muted hover:text-text'
                }`
              }
            >
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <main
          ref={main}
          id="main"
          tabIndex={-1}
          className="min-w-0 grow px-4 pb-28 pt-6 md:px-8 md:pb-8"
        >
          <div className="max-w-3xl">
            <Outlet />
          </div>
        </main>
      </div>
    </>
  );
}
