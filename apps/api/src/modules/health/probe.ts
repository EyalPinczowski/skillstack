import type { Database } from '../../db/database';

export type DatabaseStatus = 'ok' | 'unavailable' | 'not_configured';

export interface DatabaseProbe {
  /** Never throws, and never carries error text: only one of three words. */
  check(): Promise<DatabaseStatus>;
}

/** Long enough that a burst of health calls is one query, short enough that a recovery shows soon. */
export const DEFAULT_PROBE_CACHE_MS = 5000;

/**
 * Wraps `db.ping` for the health routes. `/health` is open and exempt from the rate limit (so the
 * keep-warm ping cannot be starved), so the result, success or failure, is shared for a few
 * seconds: callers cannot turn the health route into a stream of database connections.
 */
export function createDatabaseProbe(
  db: Database | null,
  options: { cacheMs?: number } = {},
): DatabaseProbe {
  const cacheMs = options.cacheMs ?? DEFAULT_PROBE_CACHE_MS;
  let cached: { at: number; result: Promise<DatabaseStatus> } | null = null;

  return {
    check() {
      if (!db) return Promise.resolve('not_configured');
      const now = Date.now();
      if (cached && now - cached.at < cacheMs) return cached.result;
      const result = Promise.resolve()
        .then(() => db.ping())
        .then(
          (ping): DatabaseStatus => (ping.ok ? 'ok' : 'unavailable'),
          (): DatabaseStatus => 'unavailable',
        );
      cached = { at: now, result };
      return result;
    },
  };
}
