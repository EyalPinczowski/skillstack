import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../lib/query-client';
import { ApiStatus } from './ApiStatus';

const API = 'https://api.example.test';
const WAKING = /Waking up the server… this can take up to a minute on the free plan/;

const health = (environment = 'rnd') =>
  new Response(JSON.stringify({ status: 'ok', environment }), { status: 200 });

function renderStatus() {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ApiStatus apiUrl={API} />
    </QueryClientProvider>,
  );
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ApiStatus', () => {
  it('asks the versioned health endpoint and shows the environment when connected', async () => {
    fetchMock.mockResolvedValue(health('rnd'));
    renderStatus();
    expect(await screen.findByText(/Connected/)).toBeInTheDocument();
    expect(screen.getByText(/rnd/)).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API}/api/v1/health`);
    expect(screen.queryByText(WAKING)).not.toBeInTheDocument();
  });

  it('says it is checking, then explains the cold start after 3 seconds', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderStatus();
    expect(screen.getByText('Checking the server…')).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(2900));
    expect(screen.queryByText(WAKING)).not.toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(screen.getByText(WAKING)).toBeInTheDocument();
  });

  it('shows an error with a Retry button that tries again', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    renderStatus();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Can’t reach the server.');

    fetchMock.mockResolvedValueOnce(health('operational'));
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/Connected/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a non-2xx answer as an error', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 503 }));
    renderStatus();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('treats an unexpected body as an error', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ hello: 'world' }), { status: 200 }));
    renderStatus();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
