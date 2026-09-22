import { expect, test } from '@playwright/test';

/** Kept in step with the script that runs it; nothing else reads these. */
const ADMIN = { email: 'persistence@example.com', password: 'a-long-enough-password' };

test('creates the admin through the setup form', async ({ page }) => {
  await page.goto('/en/setup');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByLabel('Confirm password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Create admin account' }).click();
  await expect(page).toHaveURL(/\/en\/accounts$/);
});
