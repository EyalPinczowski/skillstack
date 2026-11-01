import pg from 'pg';

/** How long a connection attempt may take before it fails (an unreachable host would hang for minutes). */
export const CONNECT_TIMEOUT_MS = 15_000;

/** A pg client that gives up connecting after `timeoutMs` instead of waiting for the OS. */
export function createClient(connectionString: string, timeoutMs = CONNECT_TIMEOUT_MS): pg.Client {
  return new pg.Client({ connectionString, connectionTimeoutMillis: timeoutMs });
}

export const CONNECTION_HINT =
  'Hint: use the Supabase Session pooler connection string (host *.pooler.supabase.com, ' +
  'user postgres.<ref>, port 5432), not the direct db.<ref>.supabase.co host, which needs IPv6.';

const NETWORK_CODES = new Set([
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  '28P01',
  '28000',
]);

/** Removes the given secrets and any URL (so `user:password@` never survives) from text. */
export function redactText(text: string, secrets: Array<string | undefined> = []): string {
  let result = text;
  for (const secret of secrets) {
    if (secret) result = result.split(secret).join('[redacted]');
  }
  return result.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[redacted-url]');
}

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code !== '' ? code : undefined;
}

function describeOne(error: unknown): string {
  if (!(error instanceof Error))
    return typeof error === 'string' && error ? error : 'Unknown error';
  const code = codeOf(error);
  const message = error.message.trim();
  if (message && code && !message.includes(code)) return `${code}: ${message}`;
  return message || code || error.name || 'Unknown error';
}

/** True when the error looks like a connection problem, so the pooler hint applies. */
function isConnectionProblem(error: unknown, text: string): boolean {
  const inner = error instanceof AggregateError ? error.errors : [];
  if ([error, ...inner].some((e) => NETWORK_CODES.has(codeOf(e) ?? ''))) return true;
  return /timeout expired|connection terminated|password authentication failed|getaddrinfo/i.test(
    text,
  );
}

/**
 * One safe message for any error: AggregateError lists its inner errors, empty messages fall back
 * to the code or name. Never contains a URL or a given secret.
 */
export function formatError(error: unknown, secrets: Array<string | undefined> = []): string {
  let text: string;
  if (error instanceof AggregateError && error.errors.length > 0) {
    const parts = [...new Set(error.errors.map(describeOne))];
    const own = error.message.trim();
    text = `${own ? `${own}: ` : ''}${parts.join('; ')}`;
  } else {
    text = describeOne(error);
  }
  text = redactText(text, secrets);
  return isConnectionProblem(error, text) ? `${text}\n${CONNECTION_HINT}` : text;
}
