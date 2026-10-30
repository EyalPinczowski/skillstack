import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { parseEnv } from './env';
import { createQueryClient } from './lib/query-client';

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
  createRoot(root).render(
    <StrictMode>
      <App env={env} queryClient={createQueryClient()} />
    </StrictMode>,
  );
}
