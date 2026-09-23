import { expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * Connecting Cloudflare (§20, CF-1).
 *
 * The acceptance criteria are the two this integration turns on. The token, once saved, never comes back.
 * And **seeing a zone is not watching it**: a token that can see forty zones does not put forty zones on a
 * page, because that would show somebody else's traffic to a reader who never asked for it.
 */

const TOKEN = 'cf-e2e-token-value-0123456789abcdefgh';

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('Settings links to it, and it says what access it asks for before asking', async ({ page }) => {
  await page.goto('/en/settings');
  await page.getByRole('link', { name: 'Cloudflare' }).click();
  await expect(page).toHaveURL(/\/settings\/cloudflare$/);

  const main = await page.locator('main').innerText();
  expect(main).toContain('read permissions only');
  expect(main).toContain('never purges a cache');
  expect(main).toContain('No write permission is needed, and none is used');
  expect(main).toContain('Cloudflare is not connected');
});

test('THE RULING: a saved token never comes back to the browser', async ({ page }) => {
  await page.goto('/en/settings/cloudflare');
  await page.getByLabel('API token').fill(TOKEN);
  await page.getByRole('button', { name: 'Save token' }).click();
  await expect(page.getByText('Saved. It has not been verified yet.')).toBeVisible();

  await page.reload();
  expect(await page.content()).not.toContain(TOKEN);
  await expect(page.getByLabel('API token')).toHaveValue('');
  await expect(page.getByLabel('API token')).toHaveAttribute('placeholder', 'Stored — paste a new one to replace it');
});

test('THE RULING: a saved token is reported as unverified, and watching nothing', async ({ page }) => {
  await page.goto('/en/settings/cloudflare');
  const main = await page.locator('main').innerText();
  expect(main).toMatch(/saved, not verified/i);
  expect(main).toContain('A saved token is not a working token');
  expect(main).toContain('no zone chosen yet');
  expect(main).not.toMatch(/\bconnected\b/i);
});

test('the Integrations page reports it as needing attention, never as connected', async ({ page }) => {
  await page.goto('/en/settings/integrations');
  const main = await page.locator('main').innerText();
  expect(main).toContain('Cloudflare');
  expect(main).toMatch(/saved, not verified/i);
  expect(await page.content()).not.toContain(TOKEN);
});

test('verifying against a Cloudflare that is not there says so as a code, not as their words', async ({ page }) => {
  await page.goto('/en/settings/cloudflare');
  await page.getByRole('button', { name: 'Verify token' }).click();
  // There is no Cloudflare in the test stack. Whatever happened, the page shows one of its own sentences.
  await expect(page.locator('main')).toContainText(/Cloudflare (could not be reached|refused|did not answer|answered)/i);
  expect(await page.content()).not.toContain(TOKEN);
});

test('a token that is not a token is refused before it is stored', async ({ page }) => {
  await page.goto('/en/settings/cloudflare');
  await page.getByLabel('API token').fill('nope');
  await page.getByRole('button', { name: 'Save token' }).click();
  await expect(page.getByText('That does not look like a Cloudflare API token.')).toBeVisible();
});

test('§21 — connecting Cloudflare is recorded in the audit log', async ({ page }) => {
  await page.goto('/en/settings/audit');
  await expect(page.locator('main')).toContainText('Cloudflare connection changed');
  expect(await page.content()).not.toContain(TOKEN);
});

test('disconnecting deletes the token and returns the page to its default', async ({ page }) => {
  await page.goto('/en/settings/cloudflare');
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByText('Disconnected. The token has been deleted.')).toBeVisible();
  await expect(page.locator('main')).toContainText('Cloudflare is not connected');
});

test('the Cloudflare settings page renders at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/en/settings/cloudflare');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
