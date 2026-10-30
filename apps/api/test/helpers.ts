import { buildApp } from '../src/app';
import { loadConfig, type Config } from '../src/config';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return { ...loadConfig({ LOG_LEVEL: 'silent' }), ...overrides };
}

export function testApp(overrides: Partial<Config> = {}) {
  return buildApp(testConfig(overrides));
}
