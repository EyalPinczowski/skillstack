import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A fake key shaped like a legacy service_role JWT. Not a credential. */
export const FAKE_SERVICE_KEY = 'eyJfake.service-role-key-for-tests.not-a-real-secret';

export interface RecordedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingHttpHeaders;
}

/** A local stand-in for Supabase's Auth admin API. Never touches the network. */
export interface FakeSupabase {
  baseUrl: string;
  requests: RecordedRequest[];
  /** Status the next requests get (default 200). Unset entries fall back to `status`. */
  status: number;
  /** Optional per-request override, takes precedence. */
  respond?: (req: RecordedRequest) => number;
  /** Do not answer at all (for timeouts). */
  hang: boolean;
  close(): Promise<void>;
}

export async function startFakeSupabase(): Promise<FakeSupabase> {
  const fake: FakeSupabase = {
    baseUrl: '',
    requests: [],
    status: 200,
    hang: false,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
  const server: Server = createServer((req, res) => {
    const recorded = { method: req.method, url: req.url, headers: req.headers };
    fake.requests.push(recorded);
    if (fake.hang) return;
    const status = fake.respond ? fake.respond(recorded) : fake.status;
    // The body echoes the key on purpose: the client must never copy a body into its errors.
    res
      .writeHead(status, { 'content-type': 'application/json' })
      .end(JSON.stringify({ message: `fake response; apikey=${req.headers.apikey}` }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return fake;
}
