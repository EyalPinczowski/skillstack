import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { ApiError } from './errors';

const BASE = 'https://api.example.test';

const me = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'a@example.com',
  displayName: null,
  role: 'user',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: null,
  legal: {
    terms: { currentVersion: '0.1', accepted: true },
    privacy: { currentVersion: '0.1', accepted: true },
    allAccepted: true,
  },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fetchMock = vi.fn<typeof fetch>();

function client(token: string | null = 'tok-123', timeoutMs?: number) {
  return createApiClient({
    baseUrl: BASE,
    getAccessToken: async () => token,
    fetch: fetchMock,
    timeoutMs,
  });
}

/** The ApiError a call rejects with (asserted, so the tests below can read its fields). */
async function failure(pending: Promise<unknown>): Promise<ApiError> {
  const error = await pending.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

const sent = (n = 0) => fetchMock.mock.calls[n]![0] as Request;

beforeEach(() => {
  fetchMock.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('api client', () => {
  it('sends the Bearer token to the versioned path and returns the data', async () => {
    fetchMock.mockResolvedValue(json(me));
    await expect(client().getMe()).resolves.toMatchObject({ email: 'a@example.com' });
    expect(sent().url).toBe(`${BASE}/api/v1/me`);
    expect(sent().headers.get('authorization')).toBe('Bearer tok-123');
  });

  it('sends no Authorization header when signed out', async () => {
    fetchMock.mockResolvedValue(json(me));
    await client(null).getMe();
    expect(sent().headers.has('authorization')).toBe(false);
  });

  it('turns an error response into an ApiError with the API code and request id', async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          error: {
            code: 'forbidden',
            message: 'This account cannot use Skillstack.',
            requestId: 'r1',
          },
        },
        403,
      ),
    );
    const error = await failure(client().getMe());
    expect(error.kind).toBe('http');
    expect(error.status).toBe(403);
    expect(error.code).toBe('forbidden');
    expect(error.message).toBe('This account cannot use Skillstack.');
    expect(error.requestId).toBe('r1');
  });

  it('still produces an ApiError when the body is not the error shape', async () => {
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }));
    const error = await failure(client().getMe());
    expect([error.kind, error.status, error.code]).toEqual(['http', 502, 'unknown']);
  });

  it('reports a failed connection as a network ApiError', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const error = await failure(client().getMe());
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('network');
    expect(error.status).toBe(0);
  });

  it('aborts a request that gets no answer and reports a timeout', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (input) =>
        new Promise<Response>((_resolve, reject) => {
          (input as Request).signal.addEventListener('abort', () =>
            reject((input as Request).signal.reason),
          );
        }),
    );
    const pending = failure(client('t', 5000).getMe());
    await vi.advanceTimersByTimeAsync(5000);
    expect((await pending).kind).toBe('timeout');
  });

  it('lets a cancelled request through as the abort, not as an API failure', async () => {
    fetchMock.mockImplementation(
      (input) =>
        new Promise<Response>((_resolve, reject) => {
          (input as Request).signal.addEventListener('abort', () =>
            reject((input as Request).signal.reason),
          );
        }),
    );
    const controller = new AbortController();
    const pending = client()
      .getMe(controller.signal)
      .catch((e: unknown) => e);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    controller.abort(new DOMException('cancelled', 'AbortError'));
    const error = await pending;
    expect(error).not.toBeInstanceOf(ApiError);
  });

  it('sends only the display name on PATCH /me, never a user id', async () => {
    fetchMock.mockResolvedValue(json({ ...me, displayName: 'Dana' }));
    await client().updateDisplayName('Dana');
    expect(sent().method).toBe('PATCH');
    expect(await sent().clone().json()).toEqual({ displayName: 'Dana' });
  });

  it('posts a legal acceptance with document and version', async () => {
    fetchMock.mockResolvedValue(json(me));
    await client().acceptLegal('terms', '0.1');
    expect(sent().url).toBe(`${BASE}/api/v1/me/legal-acceptances`);
    expect(await sent().clone().json()).toEqual({ document: 'terms', version: '0.1' });
  });

  it('sends the typed confirmation with DELETE /me and accepts the empty 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(client().deleteAccount('delete my account')).resolves.toBeUndefined();
    expect(sent().method).toBe('DELETE');
    expect(await sent().clone().json()).toEqual({ confirmation: 'delete my account' });
  });
});
