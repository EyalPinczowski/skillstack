import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config';
import { featureNames } from '../src/features';

describe('loadConfig defaults', () => {
  it('are exactly the documented ones, with every feature flag off', () => {
    expect(loadConfig({})).toEqual({
      appEnv: 'operational',
      port: 3000,
      host: '0.0.0.0',
      logLevel: 'info',
      corsOrigins: [],
      rateLimitPerMinute: 120,
      trustProxy: 0,
      features: {
        notifications: false,
        sharing: false,
        offline: false,
        pushNotifications: false,
      },
    });
    expect(featureNames).toHaveLength(4);
  });
});

describe('loadConfig', () => {
  it('parses a comma separated origin list', () => {
    const config = loadConfig({ CORS_ORIGINS: 'https://a.example.com, http://localhost:5173' });
    expect(config.corsOrigins).toEqual(['https://a.example.com', 'http://localhost:5173']);
  });

  it('fails fast on a bad PORT and names the variable', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/PORT/);
  });

  it('lists every bad variable at once', () => {
    try {
      loadConfig({ PORT: 'x', APP_ENV: 'prod', RATE_LIMIT_PER_MINUTE: '0' });
      expect.unreachable();
    } catch (err) {
      expect((err as ConfigError).problems).toHaveLength(3);
      expect((err as ConfigError).message).toMatch(/APP_ENV[\s\S]*PORT|PORT[\s\S]*APP_ENV/);
    }
  });

  it.each(['*', 'https://app.example.com/', 'https://app.example.com/path', 'app.example.com'])(
    'rejects %s as a CORS origin',
    (origin) => {
      expect(() => loadConfig({ CORS_ORIGINS: origin })).toThrow(/CORS_ORIGINS/);
    },
  );
});

describe('TRUST_PROXY', () => {
  it.each([
    ['0', 0],
    ['1', 1],
    ['2', 2],
  ])('accepts the hop count %s', (value, expected) => {
    expect(loadConfig({ TRUST_PROXY: value }).trustProxy).toBe(expected);
  });

  it.each(['true', 'false', '-1', '1.5', 'abc', '', '01'])('rejects %j', (value) => {
    expect(() => loadConfig({ TRUST_PROXY: value })).toThrow(/TRUST_PROXY/);
  });
});

describe('boolean variables', () => {
  it('turns a feature flag on only with the literal "true"', () => {
    const config = loadConfig({
      FEATURE_SHARING: 'true',
      FEATURE_PUSH_NOTIFICATIONS: 'true',
      FEATURE_OFFLINE: 'false',
    });
    expect(config.features).toEqual({
      notifications: false,
      sharing: true,
      offline: false,
      pushNotifications: true,
    });
  });

  it.each(['1', 'yes', 'TRUE', 'True', 'on', ' true', ''])(
    'rejects %j and names the variable',
    (value) => {
      expect(() => loadConfig({ FEATURE_NOTIFICATIONS: value })).toThrow(
        /FEATURE_NOTIFICATIONS: must be exactly "true" or "false"/,
      );
    },
  );
});
