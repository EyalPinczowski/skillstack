import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './styles/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { env } from './env';
import { createQueryClient } from './lib/query-client';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App env={env} queryClient={createQueryClient()} />
  </StrictMode>,
);
