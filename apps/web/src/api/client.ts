import createClient from 'openapi-fetch';
import { combineSignals, REQUEST_TIMEOUT_MS } from '../lib/abort';
import { ApiError } from './errors';
import type { paths } from './schema';

export type Me = paths['/api/v1/me']['get']['responses'][200]['content']['application/json'];
export type DataExport =
  paths['/api/v1/me/export']['get']['responses'][200]['content']['application/json'];
export type LegalDocument =
  paths['/api/v1/me/legal-acceptances']['post']['requestBody']['content']['application/json']['document'];

export interface ApiClientOptions {
  /** Base URL of the API, without a trailing slash. */
  baseUrl: string;
  /** The current Supabase access token (refreshed by the library), or null when signed out. */
  getAccessToken: () => Promise<string | null>;
  /** Replaceable for tests. Looked up on every call so a stubbed global fetch is honoured. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

type Result<T> = { data?: T; error?: unknown; response: Response };

/** Turns an openapi-fetch result into the data, or throws the one ApiError shape. */
export async function unwrap<T>(pending: Promise<Result<T>>): Promise<T> {
  const { data, error, response } = await pending;
  if (!response.ok) throw ApiError.fromBody(response.status, error);
  return data as T;
}

/**
 * The only place that talks to the API: adds the Bearer token, a request timeout and one error
 * type. Hooks in `hooks.ts` are the only callers (spec 12.3: all data access through one layer).
 */
export function createApiClient({
  baseUrl,
  getAccessToken,
  fetch: fetchOverride,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: ApiClientOptions) {
  const guardedFetch = async (request: Request): Promise<Response> => {
    const callerSignal = request.signal;
    // A timer plus AbortController rather than AbortSignal.timeout, so tests can fake the clock.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error('Request timed out')), timeoutMs);
    try {
      const token = await getAccessToken();
      const headers = new Headers(request.headers);
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const outgoing = new Request(request, {
        headers,
        signal: combineSignals(callerSignal, timeout),
      });
      return await (fetchOverride ?? globalThis.fetch)(outgoing);
    } catch (error) {
      // The caller cancelled (for example the query was dropped): not a failure to report.
      if (callerSignal.aborted) throw error;
      throw timeout.signal.aborted ? ApiError.timeout() : ApiError.network();
    } finally {
      clearTimeout(timer);
    }
  };

  const raw = createClient<paths>({ baseUrl, fetch: guardedFetch });

  return {
    /** For hooks of later features: `unwrap(api.raw.GET('/api/v1/plans'))`. */
    raw,
    getMe: (signal?: AbortSignal) => unwrap(raw.GET('/api/v1/me', { signal })),
    updateDisplayName: (displayName: string | null) =>
      unwrap(raw.PATCH('/api/v1/me', { body: { displayName } })),
    acceptLegal: (document: LegalDocument, version: string) =>
      unwrap(raw.POST('/api/v1/me/legal-acceptances', { body: { document, version } })),
    exportData: () => unwrap(raw.GET('/api/v1/me/export')),
    deleteAccount: (confirmation: string) =>
      unwrap(raw.DELETE('/api/v1/me', { body: { confirmation } })),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
