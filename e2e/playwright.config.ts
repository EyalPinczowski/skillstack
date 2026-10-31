import { defineConfig } from '@playwright/test';
import { E2E_TIME_ZONE, WEB_URL } from './support/env';

/**
 * End-to-end tests of the core flows (spec 9) against the real stack, started by global-setup.ts.
 * Chromium only. The flows run one after another: they share one API process and one database.
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]]
    : [['list']],
  use: {
    baseURL: WEB_URL,
    locale: 'en-US',
    timezoneId: E2E_TIME_ZONE,
    // Kept only for a failing test (CI uploads them, with a 7 day retention).
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
