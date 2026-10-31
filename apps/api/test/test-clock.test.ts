import { describe, expect, it } from 'vitest';
import { testClockFromEnv } from '../src/test-clock';

describe('testClockFromEnv (TEST-ONLY E2E_NOW)', () => {
  it('uses the real clock when E2E_NOW is not set', () => {
    expect(testClockFromEnv({ NODE_ENV: 'test' })).toBeUndefined();
    expect(testClockFromEnv({ NODE_ENV: 'test', E2E_NOW: '  ' })).toBeUndefined();
  });

  it('freezes the clock outside production', () => {
    for (const nodeEnv of ['test', 'development', undefined]) {
      const now = testClockFromEnv({ NODE_ENV: nodeEnv, E2E_NOW: '2026-11-02T06:00:00Z' });
      expect(now?.().toISOString()).toBe('2026-11-02T06:00:00.000Z');
    }
    const offset = testClockFromEnv({ E2E_NOW: '2026-11-02T08:00:00+02:00' });
    expect(offset?.().toISOString()).toBe('2026-11-02T06:00:00.000Z');
  });

  it('returns a new Date each time, so callers cannot change the clock', () => {
    const now = testClockFromEnv({ E2E_NOW: '2026-11-02T06:00:00Z' })!;
    now().setUTCFullYear(1999);
    expect(now().toISOString()).toBe('2026-11-02T06:00:00.000Z');
  });

  it('is ignored in production, whatever the variable says', () => {
    expect(
      testClockFromEnv({ NODE_ENV: 'production', E2E_NOW: '2026-11-02T06:00:00Z' }),
    ).toBeUndefined();
    // Even a broken value does not matter there: nothing reads it.
    expect(testClockFromEnv({ NODE_ENV: 'production', E2E_NOW: 'garbage' })).toBeUndefined();
  });

  it('refuses a value that is not an instant, instead of using the real time', () => {
    for (const bad of ['garbage', '2026-11-02', '2026-11-02T06:00:00', '2026-13-45T00:00:00Z']) {
      expect(() => testClockFromEnv({ NODE_ENV: 'test', E2E_NOW: bad }), bad).toThrow(/E2E_NOW/);
    }
  });
});
