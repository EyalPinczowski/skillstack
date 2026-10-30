import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { createBrowserAuthService } from './auth/auth-service';
import { parseEnv } from './env';
import { createQueryClient } from './lib/query-client';
import { applyTheme, readTheme } from './lib/theme';

/** Plain DOM on purpose: this runs when the app itself cannot start. */
function showConfigError(root: HTMLElement, error: unknown) {
  const title = document.createElement('h1');
  title.textContent = 'Skillstack could not start';
  const detail = document.createElement('pre');
  detail.textContent = error instanceof Error ? error.message : String(error);
  detail.style.whiteSpace = 'pre-wrap';
  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  box.style.cssText = 'max-width:40rem;margin:0 auto;padding:1.5rem 1rem';
  box.append(title, detail);
  root.replaceChildren(box);
}

/** Reads the environment before React mounts, so a bad build shows a message, not a blank page. */
export function mount(root: HTMLElement, rawEnv: Record<string, unknown>) {
  let env;
  try {
    env = parseEnv(rawEnv);
  } catch (error) {
    showConfigError(root, error);
    return;
  }
  // Before the first paint, so a saved light or dark choice does not flash the other theme.
  applyTheme(readTheme());
  createRoot(root).render(
    <StrictMode>
      <BrowserRouter>
        <App env={env} queryClient={createQueryClient()} auth={createBrowserAuthService(env)} />
      </BrowserRouter>
    </StrictMode>,
  );
}
