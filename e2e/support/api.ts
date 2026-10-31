import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type APIRequestContext } from '@playwright/test';
import { REPO_ROOT } from './env';

/** Calls on the real API as the test user (set-up and checks that do not need the screen). */

export async function acceptCurrentLegal(api: APIRequestContext): Promise<void> {
  const me = await (await api.get('/api/v1/me')).json();
  for (const document of ['terms', 'privacy'] as const) {
    const response = await api.post('/api/v1/me/legal-acceptances', {
      data: { document, version: me.legal[document].currentVersion },
    });
    expect(response.ok(), `accepting the ${document}`).toBe(true);
  }
}

/** Imports the fictional demo plan (the same file as the "Load the demo plan" button). */
export async function importDemoPlan(api: APIRequestContext): Promise<string> {
  const file = join(REPO_ROOT, 'data/sample-plans/demo-plan.json');
  const id = randomUUID();
  const response = await api.post('/api/v1/plans/import', {
    data: { ...JSON.parse(readFileSync(file, 'utf8')), id },
  });
  expect(response.status(), await response.text()).toBe(201);
  return id;
}
