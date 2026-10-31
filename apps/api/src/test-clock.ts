/**
 * TEST-ONLY clock for the end-to-end tests (e2e/). When `E2E_NOW` holds an ISO timestamp with an
 * offset, for example 2026-11-02T06:00:00Z, the server uses that fixed instant as "now", so the
 * plan-local day is the same on every run.
 *
 * It is ignored when NODE_ENV is `production`, whatever E2E_NOW says, so a stray variable can never
 * freeze the clock of the real service. A value that is set but is not a valid timestamp stops the
 * start-up instead of silently using the real time.
 */
export function testClockFromEnv(env: NodeJS.ProcessEnv): (() => Date) | undefined {
  const raw = env.E2E_NOW?.trim();
  if (!raw || env.NODE_ENV === 'production') return undefined;
  // Plain string checks: the value must name an instant (a "Z" or an offset), never a local time.
  const hasZone = raw.endsWith('Z') || raw.slice(-6).match(/^[+-]\d\d:\d\d$/) !== null;
  const ms = Date.parse(raw);
  if (!hasZone || Number.isNaN(ms)) {
    throw new Error('E2E_NOW must be an ISO timestamp with a time zone, e.g. 2026-11-02T06:00:00Z');
  }
  return () => new Date(ms);
}
