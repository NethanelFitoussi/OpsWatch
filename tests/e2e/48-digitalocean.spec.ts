import { expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * Connecting a DigitalOcean account (§S10).
 *
 * The real provider cannot be exercised from here, so what is accepted is everything up to its
 * endpoint: what the page promises before asking for the token, that the token never comes back out,
 * and that a failed read says which failure it was rather than showing an empty list.
 */

test.beforeEach(async ({ page }) => {
  await login(page);
});

const TOKEN = `dop_v1_${'a'.repeat(57)}`;

const create = async (page: import('@playwright/test').Page, name: string) => {
  await page.goto('/en/accounts/new/do');
  await page.getByLabel('Connection name').fill(name);
  await page.getByLabel('Personal access token').fill(TOKEN);
  await page.getByRole('button', { name: 'Create connection' }).click();
  await page.waitForURL(/\/en\/accounts\/[0-9a-f]{12}$/);
  return /\/accounts\/([0-9a-f]{12})/.exec(page.url())?.[1] as string;
};

test('THE RULING: it asks for the narrow scope, and says why not the wide one', async ({ page }) => {
  await page.goto('/en/accounts/new/do');
  const main = await page.locator('main').innerText();

  const scope = main.indexOf('droplet:read');
  const field = main.indexOf('Personal access token');
  expect(scope).toBeGreaterThan(-1);
  // Said before the field it is asked for in, not after it.
  expect(scope).toBeLessThan(field);
  expect(main).toContain('Not api:read');
  expect(main).toContain('asking for access it has no plan for');
});

test('THE RULING: the token goes in and never comes back out', async ({ page }) => {
  const id = await create(page, 'Droplets account');

  // Not on the connection page, in any form a browser can see.
  const html = await page.content();
  expect(html).not.toContain(TOKEN);
  expect(await page.locator('main').innerText()).not.toContain(TOKEN);

  // Not on the droplets page either.
  await page.goto(`/en/accounts/${id}/droplets`);
  expect(await page.content()).not.toContain(TOKEN);

  // And a field is never repopulated with it after an error, which would put it in the HTML.
  await page.goto('/en/accounts/new/do');
  await page.getByLabel('Connection name').fill('Rejected');
  await page.getByLabel('Personal access token').fill('too-short');
  await page.getByRole('button', { name: 'Create connection' }).click();
  await expect(page.locator('main')).toContainText('does not look like a DigitalOcean token');
  await expect(page.getByLabel('Personal access token')).toHaveValue('');
  // The name is kept, because retyping that is not part of fixing the mistake.
  await expect(page.getByLabel('Connection name')).toHaveValue('Rejected');
});

test('a read that failed says which failure, and never shows an empty list', async ({ page }) => {
  // The token is well-formed and not real, so DigitalOcean rejects it — which is the state an
  // operator is in when they paste a revoked one, and the one worth being clear about.
  const id = await create(page, 'Unreal token');
  await page.goto(`/en/accounts/${id}/droplets`);

  const main = await page.locator('main').innerText();
  expect(main).toMatch(/rejected the token|not allowed to read droplets|could not reach DigitalOcean|returned an error/);
  await expect(page.locator('main table')).toHaveCount(0);
  expect(main).toContain('Nothing about a DigitalOcean account is collected on a schedule yet');
});

test('the droplets page belongs to DigitalOcean connections only', async ({ page }) => {
  await page.goto('/en/accounts');
  const href = (await page.getByRole('link', { name: /Moto monitoring/ }).first().getAttribute('href')) ?? '';
  await page.goto(`${href}/droplets`);
  await expect(page.locator('main')).toContainText('Page not found');
});

test('DigitalOcean renders at 360px in French, with no raw key anywhere', async ({ page }) => {
  const id = await create(page, 'Narrow droplets');
  await page.setViewportSize({ width: 360, height: 800 });
  for (const path of ['/fr/accounts/new/do', `/fr/accounts/${id}`, '/fr/getting-started/do']) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
    expect(await page.locator('main').innerText(), path).not.toMatch(/DoWizard\.|DoSetup\.|GettingStarted\./);
  }
});

test('THE RULING: the monitoring sections are not offered to a connection they are not about', async ({ page }) => {
  /*
   * Every section under /c/{id}/{region} is a page about an AWS service. A DigitalOcean connection has
   * a name and a status like any other, so without a check it appeared in the switcher with regions
   * that led to pages which then asked AWS about an account that does not exist — which an operator
   * reads as "OpsWatch cannot see my droplets" rather than "this page is not about them".
   */
  const id = await create(page, 'Not an AWS account');
  await page.goto(`/en/accounts/${id}`);

  // Hand-typed or bookmarked, it is a 404 rather than a page apologising for AWS.
  await page.goto(`/en/c/${id}/eu-west-1/containers/services`);
  await expect(page.locator('main')).toContainText('Page not found');

  // And the switcher offers it as a connection to open, not as regions to monitor.
  await page.goto('/en/accounts');
  await page.getByRole('button', { name: 'Connection', exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toContainText('Not an AWS account');
  await expect(menu.getByRole('menuitem', { name: 'Open the connection' }).first()).toBeVisible();
});
