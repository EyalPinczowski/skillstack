import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config';
import { featureNames, loadFeatures } from '../src/features';

describe('loadConfig', () => {
  it('applies the documented defaults', () => {
    expect(loadConfig({})).toMatchObject({
      appEnv: 'operational',
      port: 3000,
      host: '0.0.0.0',
      logLevel: 'info',
      corsOrigins: [],
      rateLimitPerMinute: 120,
    });
  });

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

describe('feature flags', () => {
  it('are all off by default', () => {
    expect(featureNames).toHaveLength(4);
    for (const features of [loadFeatures({}), loadConfig({}).features]) {
      expect(Object.keys(features).sort()).toEqual([
        'notifications',
        'offline',
        'pushNotifications',
        'sharing',
      ]);
      expect(Object.values(features).every((v) => v === false)).toBe(true);
    }
  });

  it('can be turned on, but only by FEATURE_<NAME>=true', () => {
    const features = loadFeatures({
      FEATURE_SHARING: 'true',
      FEATURE_PUSH_NOTIFICATIONS: '1',
      FEATURE_OFFLINE: 'false',
      FEATURE_NOTIFICATIONS: 'yes',
    });
    expect(features).toEqual({
      notifications: false,
      sharing: true,
      offline: false,
      pushNotifications: true,
    });
  });
});
