import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
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

/** Moves the fake clock and lets promises and React Query's scheduled updates run. */
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

/** A fetch that never answers but rejects when its signal aborts, like the real one. */
const hangingFetch = (_input: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  onlineManager.setOnline(true);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ApiStatus', () => {
  it('asks the versioned health endpoint and shows the environment when connected', async () => {
    fetchMock.mockResolvedValue(health('rnd'));
    renderStatus();
    await advance(0);
    expect(screen.getByText(/Connected/)).toBeInTheDocument();
    expect(screen.getByText(/rnd/)).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API}/api/v1/health`);
    expect(screen.queryByText(WAKING)).not.toBeInTheDocument();
  });

  it('says it is checking, then explains the cold start after 3 seconds', async () => {
    fetchMock.mockImplementation(hangingFetch);
    renderStatus();
    expect(screen.getByText('Checking the server…')).toBeInTheDocument();

    await advance(2900);
    expect(screen.queryByText(WAKING)).not.toBeInTheDocument();

    await advance(200);
    expect(screen.getByText(WAKING)).toBeInTheDocument();
  });

  it('shows an error with a Retry button that tries again', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    renderStatus();
    await advance(0);
    expect(screen.getByRole('alert')).toHaveTextContent('Can’t reach the server.');

    fetchMock.mockResolvedValueOnce(health('operational'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await advance(0);
    expect(screen.getByText(/Connected/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a non-2xx answer as an error', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 503 }));
    renderStatus();
    await advance(0);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('treats an unexpected body as an error', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ hello: 'world' }), { status: 200 }));
    renderStatus();
    await advance(0);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('gives up after 60 seconds with an error and a Retry button', async () => {
    fetchMock.mockImplementation(hangingFetch);
    renderStatus();
    await advance(59_000);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await advance(1_000);
    await advance(100); // React Query publishes the failure on a later tick
    expect(screen.getByRole('alert')).toHaveTextContent('Can’t reach the server.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('says so when the browser is offline, with a Retry button', async () => {
    onlineManager.setOnline(false);
    renderStatus();
    await advance(0);
    expect(screen.getByText("You're offline. Reconnect to check the server.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks the server once the browser is back online', async () => {
    onlineManager.setOnline(false);
    fetchMock.mockResolvedValue(health('rnd'));
    renderStatus();
    await advance(0);
    expect(screen.getByText(/You're offline/)).toBeInTheDocument();

    act(() => onlineManager.setOnline(true));
    await advance(0);
    expect(screen.getByText(/Connected/)).toBeInTheDocument();
    expect(screen.queryByText(/You're offline/)).not.toBeInTheDocument();
  });
});
