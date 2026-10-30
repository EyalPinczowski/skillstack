import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { fakeAuth, installApi, json, meBody, renderApp, SESSION } from '../test/helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openApp() {
  installApi({ 'GET /api/v1/me': () => json(meBody()) });
  renderApp({ auth: fakeAuth(SESSION), path: '/' });
  return within(await screen.findByRole('navigation', { name: 'Main' }));
}

describe('app shell navigation', () => {
  it('has one main navigation with Today and Settings, marking the current page', async () => {
    const nav = await openApp();
    const today = nav.getByRole('link', { name: 'Today' });
    expect(today).toHaveAttribute('aria-current', 'page');
    expect(nav.getByRole('link', { name: 'Settings' })).not.toHaveAttribute('aria-current');
  });

  it('is a tab bar that scrolls sideways on a phone and a rail from tablet width', async () => {
    await openApp();
    const classes = screen.getByRole('navigation', { name: 'Main' }).className;
    for (const c of ['fixed', 'bottom-0', 'overflow-x-auto', 'md:static', 'md:w-56']) {
      expect(classes).toContain(c);
    }
  });

  it('gives every item a touch target of at least 44 by 44 px', async () => {
    const nav = await openApp();
    for (const link of nav.getAllByRole('link')) {
      expect(link.className).toContain('min-h-16');
      expect(link.className).toContain('min-w-24');
    }
  });

  it('shows each item with an icon and a text label, and marks the current one by more than colour', async () => {
    const nav = await openApp();
    const today = nav.getByRole('link', { name: 'Today' });
    expect(today.querySelector('svg')).not.toBeNull();
    expect(today.className).toContain('border-accent');
    expect(nav.getByRole('link', { name: 'Settings' }).className).toContain('border-transparent');
  });

  it('moves between pages and moves focus to the page content', async () => {
    const nav = await openApp();
    await userEvent.click(nav.getByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(nav.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('has no automatically detectable accessibility violations on the home page', async () => {
    await openApp();
    await screen.findByRole('heading', { name: 'No plan yet' });
    await screen.findByText(/Connected/);
    await expectNoAxeViolations();
  });
});
