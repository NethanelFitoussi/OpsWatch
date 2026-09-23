import { expect, test } from '@playwright/test';
import { cloudflareOverviewSchema } from '@opswatch/contract';
import { login } from './helpers';

/**
 * What connecting Cloudflare bought (CF-2).
 *
 * The acceptance criterion is the one the whole page exists for: an operator who connected Cloudflare can
 * see what OpsWatch gained from it — and, before they connect, what they would gain. The four emptinesses
 * are kept apart because each needs something different from them.
 */

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('the rail links to it, and it is not scoped to an AWS environment', async ({ page }) => {
  await page.goto('/en/accounts');
  await page.getByRole('link', { name: 'Cloudflare', exact: true }).first().click();
  // No connection id and no region: a zone belongs to the installation.
  await expect(page).toHaveURL(/\/en\/cloudflare$/);
});

test('THE RULING: not connected says what connecting would buy, and where to do it', async ({ page }) => {
  await page.goto('/en/cloudflare');
  const main = await page.locator('main').innerText();
  expect(main).toContain('Cloudflare is not connected');
  expect(main).toContain('what reached your edge');
  await expect(page.getByRole('link', { name: 'Connect Cloudflare' })).toBeVisible();
});

test('THE RULING: a saved but unverified token is its own state, not an empty dashboard', async ({ page }) => {
  await page.goto('/en/settings/cloudflare');
  await page.getByLabel('API token').fill('cf-e2e-token-value-0123456789abcdefgh');
  await page.getByRole('button', { name: 'Save token' }).click();
  await expect(page.getByText('Saved. It has not been verified yet.')).toBeVisible();

  await page.goto('/en/cloudflare');
  const main = await page.locator('main').innerText();
  expect(main).toContain('The token has not been verified');
  // Four emptinesses, and this is not the "nothing read yet" one.
  expect(main).not.toContain('Nothing has been read yet');

  await page.goto('/en/settings/cloudflare');
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.locator('main')).toContainText('Cloudflare is not connected');
});

test('the page says where its numbers come from, and claims nothing else', async ({ page }) => {
  await page.goto('/en/cloudflare');
  const main = await page.locator('main').innerText();
  expect(main).toContain('traffic, how much of it Cloudflare served from cache');
  // No modelling, no estimation, no projection.
  expect(main).not.toMatch(/estimated|projected|predicted/i);
});

test('GET /api/v1/cloudflare answers the shape every client parses', async ({ page, request }) => {
  const response = await page.request.get('/api/v1/cloudflare');
  expect(response.status(), await response.text()).toBe(200);
  const body = cloudflareOverviewSchema.parse(await response.json());
  // Nothing connected in this stack: the state says which emptiness rather than an empty list alone.
  expect(body.state).toBe('not_connected');
  expect(body.zones).toEqual([]);

  expect((await request.get('/api/v1/cloudflare')).status()).toBe(401);
});

test('the capability is false until a verified token is watching a zone', async ({ page }) => {
  const info = await page.request.get('/api/v1/server').then((r) => r.json());
  expect(info.features.cloudflare).toBe(false);
});

test('the Cloudflare page renders at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/en/cloudflare');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
