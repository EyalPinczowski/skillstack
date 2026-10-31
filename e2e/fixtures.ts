import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';
import { allowEmail } from './support/db';
import { API_URL, WORKER_ENV, requireEnv } from './support/env';
import { issueToken } from './support/tokens';

/** Must match E2E_TOKEN_KEY in apps/web/src/e2e/e2e-auth-service.ts (test-only build). */
const TOKEN_KEY = 'skillstack.e2e.access-token';

export interface TestUser {
  id: string;
  email: string;
  token: string;
}

interface Fixtures {
  /** A new person on the allowlist with a signed token. One per test, so tests never share data. */
  user: TestUser;
  /** The API with this user's token, for set-up and for checks that do not need the screen. */
  api: APIRequestContext;
  /** Fails the test on any console error, uncaught page error or CSP violation. */
  pageProblems: string[];
}

export const test = base.extend<Fixtures>({
  // Playwright requires a destructuring pattern as the first argument, even an empty one.
  // eslint-disable-next-line no-empty-pattern
  user: async ({}, use) => {
    const id = randomUUID();
    const user = { id, email: `e2e-${id.slice(0, 8)}@example.test`, token: '' };
    await allowEmail(requireEnv(WORKER_ENV.superuserUrl), user.email);
    user.token = await issueToken(user);
    await use(user);
  },

  api: async ({ playwright, user }, use) => {
    const context = await playwright.request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { authorization: `Bearer ${user.token}` },
    });
    await use(context);
    await context.dispose();
  },

  pageProblems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      // The API answers 404 for "no review saved yet for this date" (docs/api-reviews.md) and the
      // browser logs every failed request as a console error. Only that one case is allowed, and
      // only as many times as the API really answered it.
      let allowed404 = 0;
      page.on('response', (response) => {
        const url = new URL(response.url());
        if (
          response.status() === 404 &&
          response.request().method() === 'GET' &&
          /^\/api\/v1\/plans\/[^/]+\/days\/[\d-]+\/review$/.test(url.pathname)
        ) {
          allowed404 += 1;
        }
      });
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (text.startsWith('Failed to load resource') && text.includes('404') && allowed404 > 0) {
          allowed404 -= 1;
          return;
        }
        problems.push(`console error: ${text}`);
      });
      page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
      // A violation of the app's Content-Security-Policy, reported with where it came from. (A
      // violation caused by the app itself once showed up here: Zod's eval probe, see zod-config.ts.)
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          console.error(
            `CSP violation: ${event.violatedDirective} ${event.blockedURI} at ${event.sourceFile}:${event.lineNumber} ${event.sample}`,
          );
        });
      });
      await use(problems);
      expect(problems, 'no console errors, page errors or CSP violations').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * "Signs in" by putting the user's token where the e2e build of the app looks for it. The API
 * still checks the token's signature, issuer and expiry.
 */
export async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.addInitScript(([key, token]) => window.localStorage.setItem(key, token), [
    TOKEN_KEY,
    user.token,
  ] as const);
}

/** WCAG 2.x A and AA rules of axe-core on the current screen; any violation fails the test. */
export async function expectNoA11yViolations(page: Page, screen: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help} - ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
  expect(summary, `accessibility violations on ${screen}`).toEqual([]);
}
