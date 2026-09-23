import { expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * Settings → Repositories (§13, §I).
 *
 * Two things are being accepted: an operator can record a repository without supplying any credential, and
 * the page states §13's read-only promise where the token is asked for rather than in documentation.
 */

test('Repositories needs a session', async ({ page }) => {
  await page.goto('/en/settings/repositories');
  await expect(page).toHaveURL(/\/en\/login$/);
});

test('Settings links to it', async ({ page }) => {
  await login(page);
  await page.goto('/en/settings');
  await page.getByRole('link', { name: 'Repositories' }).click();
  await expect(page).toHaveURL(/\/en\/settings\/repositories$/);
});

test('§13 — the read-only promise is stated where the token is asked for', async ({ page }) => {
  await login(page);
  await page.goto('/en/settings/repositories');
  const main = await page.locator('body').innerText();
  expect(main).toContain('creates no branch, no issue, no comment and no commit');
  expect(main).toContain('Contents: Read and Metadata: Read');
});

test('a repository can be recorded with no credential at all', async ({ page }) => {
  await login(page);
  await page.goto('/en/settings/repositories');
  await expect(page.getByText('No repository has been added yet')).toBeVisible();
  // The page says the free half works without a token, rather than refusing until one is supplied.
  await expect(page.getByText('No token is needed for this', { exact: false })).toBeVisible();

  await page.getByLabel('Owner').fill('acme');
  await page.getByLabel('Repository', { exact: true }).fill('storefront');
  await page.getByLabel('Default branch').fill('trunk');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.reload();
  await expect(page.locator('body')).toContainText('acme/storefront');
  await expect(page.locator('body')).toContainText('default branch: trunk');
});

test('the token field is write-only: nothing stored is ever sent back to the browser', async ({ page }) => {
  await login(page);
  await page.goto('/en/settings/repositories');
  await expect(page.getByText('No token is stored')).toBeVisible();

  await page.getByLabel('Fine-grained personal access token').fill('github_pat_'.padEnd(60, 'x'));
  await page.getByRole('button', { name: 'Save token' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.reload();
  await expect(page.getByText('A token is stored')).toBeVisible();
  // The field comes back empty, and the stored value appears nowhere in the document.
  await expect(page.getByLabel('Fine-grained personal access token')).toHaveValue('');
  expect(await page.content()).not.toContain('github_pat_');
});

test('a repository can be removed, so a wrong entry is undoable', async ({ page }) => {
  await login(page);
  await page.goto('/en/settings/repositories');
  await page.getByRole('button', { name: 'Remove' }).first().click();
  await expect(page.getByText('No repository has been added yet')).toBeVisible();
});

test('Repositories renders at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page);
  await page.goto('/en/settings/repositories');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
