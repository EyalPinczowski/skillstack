import { APP_TAGLINE } from '@skillstack/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { Env } from './env';
import { createQueryClient } from './lib/query-client';

const env: Env = { appEnv: 'operational', apiUrl: 'https://api.example.test' };

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  );
});

describe('App shell', () => {
  it('makes the skip link the first focusable element, pointing at main', async () => {
    render(<App env={env} queryClient={createQueryClient()} />);
    await userEvent.tab();
    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });

  it('shows the app name and tagline from the shared package', () => {
    render(<App env={env} queryClient={createQueryClient()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Skillstack' })).toBeInTheDocument();
    expect(screen.getByText(APP_TAGLINE)).toBeInTheDocument();
  });

  it('wires the environment into the badge and banner', () => {
    const { rerender } = render(<App env={env} queryClient={createQueryClient()} />);
    expect(screen.queryByText('R&D environment')).not.toBeInTheDocument();
    expect(screen.queryByText('Demo – sample data')).not.toBeInTheDocument();

    rerender(<App env={{ ...env, appEnv: 'rnd' }} queryClient={createQueryClient()} />);
    expect(screen.getByText('R&D environment')).toBeInTheDocument();

    rerender(<App env={{ ...env, appEnv: 'demo' }} queryClient={createQueryClient()} />);
    expect(screen.getByText('Demo – sample data')).toBeInTheDocument();
  });
});
