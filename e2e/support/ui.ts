import { expect, type Page } from '@playwright/test';

/** Accepts the Terms and loads the demo plan through the screen, ending on Today with blocks. */
export async function loadDemoPlan(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('I have read and accept the Terms of Use and the Privacy Policy.').check();
  await page.getByRole('button', { name: 'Accept and continue' }).click();
  await page.getByRole('button', { name: 'Load the demo plan' }).click();
  await expect(page.getByRole('heading', { name: 'Today’s blocks' })).toBeVisible();
}
