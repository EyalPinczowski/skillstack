import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENV, fakeAuth, installApi, json, meBody, renderApp, SESSION } from './test/helpers';

beforeEach(() => {
  installApi({ 'GET /api/v1/me': () => json(meBody()) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App shell', () => {
  it('makes the skip link the first focusable element, pointing at main', async () => {
    renderApp({ auth: fakeAuth(null), path: '/signin' });
    await userEvent.tab();
    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute('href', '#main');
    expect(await screen.findByRole('main')).toHaveAttribute('id', 'main');
  });

  it('builds the skip link without sr-only, which would strip its padding', async () => {
    renderApp({ auth: fakeAuth(null), path: '/signin' });
    const classes = screen.getByRole('link', { name: 'Skip to main content' }).classList;
    expect(classes).not.toContain('sr-only');
    expect(classes).not.toContain('focus:not-sr-only');
    expect(classes).toContain('px-4');
    expect(classes).toContain('py-3');
    expect(classes).toContain('min-h-11');
    expect(classes).toContain('-translate-y-[200%]');
    expect(classes).toContain('focus:translate-y-0');
    expect(Array.from(classes).some((c) => c.includes('transition'))).toBe(false);
  });

  it('shows the app name and tagline on the sign-in page', async () => {
    renderApp({ auth: fakeAuth(null), path: '/signin' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getAllByText('Skillstack').length).toBeGreaterThan(0);
  });

  it('wires the environment into the badge and banner', async () => {
    const { unmount } = renderApp({ auth: fakeAuth(null), path: '/signin' });
    expect(screen.queryByText('R&D environment')).not.toBeInTheDocument();
    expect(screen.queryByText('Demo – sample data')).not.toBeInTheDocument();
    unmount();

    const rnd = renderApp({
      auth: fakeAuth(null),
      path: '/signin',
      env: { ...ENV, appEnv: 'rnd' },
    });
    expect(screen.getByText('R&D environment')).toBeInTheDocument();
    rnd.unmount();

    renderApp({ auth: fakeAuth(null), path: '/signin', env: { ...ENV, appEnv: 'demo' } });
    expect(screen.getByText('Demo – sample data')).toBeInTheDocument();
  });

  it('keeps the server status on the signed-in home page', async () => {
    renderApp({ auth: fakeAuth(SESSION), path: '/' });
    expect(await screen.findByRole('heading', { name: 'No plan yet' })).toBeInTheDocument();
    expect(await screen.findByText(/Connected/)).toBeInTheDocument();
  });
});
