import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { fakeAuth, installApi, renderApp } from '../test/helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('legal pages', () => {
  it.each([
    ['/terms', 'Skillstack – Terms of Use'],
    ['/privacy', 'Skillstack – Privacy Policy'],
    ['/disclaimer', 'Skillstack – Disclaimer'],
  ])('shows %s to a signed-out visitor, rendered from docs/legal', async (path, heading) => {
    installApi({});
    renderApp({ auth: fakeAuth(null), path });
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('keeps the placeholders in square brackets exactly as written', async () => {
    installApi({});
    renderApp({ auth: fakeAuth(null), path: '/terms' });
    await screen.findByRole('heading', { level: 1 });
    expect(document.body).toHaveTextContent('[EFFECTIVE DATE]');
    expect(document.body).toHaveTextContent('[CONTACT EMAIL]');
  });

  it('shows the version line of the document', async () => {
    installApi({});
    renderApp({ auth: fakeAuth(null), path: '/terms' });
    await screen.findByRole('heading', { level: 1 });
    expect(document.body).toHaveTextContent(/Version 0\.1/);
  });

  it('links to the other two documents and back to the app', async () => {
    installApi({});
    renderApp({ auth: fakeAuth(null), path: '/privacy' });
    const nav = within(await screen.findByRole('navigation', { name: 'Legal documents' }));
    expect(nav.getByRole('link', { name: 'Terms of Use' })).toHaveAttribute('href', '/terms');
    expect(nav.getByRole('link', { name: 'Disclaimer' })).toHaveAttribute('href', '/disclaimer');
    expect(nav.queryByRole('link', { name: 'Privacy Policy' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Skillstack' })).toHaveAttribute('href', '/');
  });

  it('renders the privacy table as a real table', async () => {
    installApi({});
    renderApp({ auth: fakeAuth(null), path: '/privacy' });
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('has no automatically detectable accessibility violations', async () => {
    installApi({});
    renderApp({ auth: fakeAuth(null), path: '/privacy' });
    await screen.findByRole('heading', { level: 1 });
    await expectNoAxeViolations();
  });
});
