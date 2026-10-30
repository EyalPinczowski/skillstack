import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './bootstrap';

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  );
});

afterEach(() => {
  root.remove();
  vi.unstubAllGlobals();
});

describe('mount', () => {
  it('shows a readable message instead of a blank page when the environment is invalid', () => {
    mount(root, { VITE_API_URL: 'localhost:3000', VITE_APP_ENV: 'staging' });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Skillstack could not start');
    expect(alert).toHaveTextContent(/VITE_API_URL/);
    expect(alert).toHaveTextContent(/VITE_APP_ENV/);
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
  });

  it('renders the app when the environment is valid', async () => {
    await act(async () => mount(root, { VITE_APP_ENV: 'rnd', VITE_API_URL: 'https://api.test' }));
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByText('R&D environment')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
