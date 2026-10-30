/** One signal that aborts when either the caller's signal or the timeout controller does. */
export function combineSignals(signal: AbortSignal, timeout: AbortController): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout.signal]);
  // Safari and iOS before 17.4 have no AbortSignal.any: forward the caller's abort instead.
  if (signal.aborted) timeout.abort(signal.reason);
  else signal.addEventListener('abort', () => timeout.abort(signal.reason), { once: true });
  return timeout.signal;
}

/** Longer than a free-plan cold start, short enough that a dead server ends in an error state. */
export const REQUEST_TIMEOUT_MS = 60_000;
