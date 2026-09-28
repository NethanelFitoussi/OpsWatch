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

test('THE RULING: a gap says whether the provider lacks it or OpsWatch has not built it', async ({ page }) => {
  /*
   * "Unsupported" would be true for both and useless for either. "DigitalOcean does not offer this"
   * ends the matter; "OpsWatch has not built it" does not — and an operator who reads the first when
   * the second is true goes looking for another product.
   */
  const id = await create(page, 'Capability table');
  await page.goto(`/en/accounts/${id}`);
  const card = page.locator('[data-slot="card"]').filter({ has: page.getByRole('heading', { name: 'What OpsWatch can read here' }) });

  await expect(card).toContainText('Resources');
  await expect(card).toContainText('Read directly from the provider');
  // DigitalOcean has no log product to read errors out of; that is not a gap in OpsWatch.
  await expect(card).toContainText('Not offered by this provider');
  await expect(card).toContainText('Not built yet in OpsWatch');

  // And the promise that makes self-hosting work, on the page rather than in a README.
  await expect(card).toContainText('nothing here requires a forwarder, an agent or an account with us');
});

test('the same question is answered for AWS, where the answer is mostly yes', async ({ page }) => {
  await page.goto('/en/accounts');
  const href = (await page.getByRole('link', { name: /Moto monitoring/ }).first().getAttribute('href')) ?? '';
  await page.goto(href);
  const card = page.locator('[data-slot="card"]').filter({ has: page.getByRole('heading', { name: 'What OpsWatch can read here' }) });

  await expect(card).toContainText('Health');
  // Forwarding is an option an operator switches on, never a condition of the capability.
  await expect(card).toContainText('Also available forwarded, if you switch that on');
  await expect(card).not.toContainText('Not offered by this provider');
});

test('THE RULING: it says CPU needs DigitalOcean’s agent, where Google’s CPU needs nothing', async ({ page }) => {
  /*
   * The one cross-provider fact this product must not smooth over. DigitalOcean measures bandwidth,
   * disk I/O and disk usage from outside the droplet and needs `do-agent` inside it for CPU, load and
   * memory. Google is close to the opposite: CPU comes from the hypervisor and memory needs the Ops
   * Agent. Showing a "CPU" column on both, or the same caveat under both, would be inventing parity
   * DigitalOcean does not offer — which is the failure this test exists to catch.
   */
  const id = await create(page, 'Agent caveat');
  await page.goto(`/en/accounts/${id}/droplets`);
  const droplets = await page.locator('main').innerText();

  expect(droplets).toContain('Public bandwidth');
  expect(droplets).toContain('measured by DigitalOcean from outside the droplet');
  expect(droplets).toContain('Nothing is installed to read them');
  // CPU is named as something the agent measures, and OpsWatch says it will not install it.
  expect(droplets).toMatch(/CPU[\s\S]{0,120}metrics agent/);
  expect(droplets).toContain('OpsWatch does not install it');

  // And on Google the same word appears on the other side of the line.
  await page.goto('/en/accounts/new/gcp');
  await page.getByLabel('Connection name').fill('Agent contrast');
  await page.getByLabel('Project ID').fill('my-project-123');
  await page.getByLabel('Project number').fill('123456789012');
  await page.getByRole('button', { name: 'Create connection' }).click();
  await page.waitForURL(/\/en\/accounts\/[0-9a-f]{12}$/);
  const google = /\/accounts\/([0-9a-f]{12})/.exec(page.url())?.[1] as string;
  await page.goto(`/en/accounts/${google}/instances`);
  const instances = await page.locator('main').innerText();

  // Google: CPU is the agentless one, memory is not.
  expect(instances).toContain('which Google writes for every running instance');
  expect(instances).toMatch(/Memory[\s\S]{0,140}Ops Agent/);
  // The two pages do not carry the same sentence about CPU, because the two clouds do not.
  expect(instances).not.toContain('metrics agent');
});

test('the droplets page reads in French, and at 360 px, with the caveat intact', async ({ page }) => {
  const id = await create(page, 'Narrow bandwidth');
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/fr/accounts/${id}/droplets`);
  const main = await page.locator('main').innerText();

  expect(main).toContain('agent de métriques');
  expect(main).toContain('Le processeur');
  expect(main).not.toMatch(/DoDroplets\./);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('THE RULING: the connections page says which cloud each connection is to', async ({ page }) => {
  /*
   * Every card on this page used to carry the AWS glyph and the word "AWS", whatever it was a
   * connection to. On the one screen whose job is to tell an operator what they are connected to,
   * that is provider identity erased — and it is invisible until somebody connects a second cloud.
   */
  await create(page, 'Named provider');
  await page.goto('/en/accounts');
  const main = await page.locator('main').innerText();

  expect(main).toContain('DigitalOcean');
  expect(main).toContain('AWS');

  // Counted by cloud, and filterable, without losing which cloud is which.
  const filters = page.getByRole('navigation', { name: 'Filter connections by cloud' });
  await expect(filters).toBeVisible();
  await expect(filters.getByRole('link', { name: /^DigitalOcean \(\d+\)$/ })).toBeVisible();

  await filters.getByRole('link', { name: /^DigitalOcean \(\d+\)$/ }).click();
  await expect(page).toHaveURL(/provider=do/);
  const filtered = await page.locator('main').innerText();
  expect(filtered).toContain('Named provider');
  // Filtered to one cloud means one cloud: an AWS account left on screen would be answering the
  // wrong question, and so would GitHub.
  expect(filtered).not.toContain('Moto monitoring');
  expect(filtered).not.toContain('GitHub');

  // The counts are of everything, so they do not change when the list does.
  const all = page.getByRole('link', { name: /^All \(\d+\)$/ });
  const before = await all.innerText();
  await page.goto('/en/accounts');
  expect(await page.getByRole('link', { name: /^All \(\d+\)$/ }).innerText()).toBe(before);
});

test('THE RULING: it says DigitalOcean does not report which alerts are firing', async ({ page }) => {
  /*
   * The pressure, when three clouds sit beside each other in one product, is to make the third look
   * like the first two. DigitalOcean exposes alert policies and no endpoint at all for which of them
   * are firing — Google has one, AWS has alarm state — so the honest page is configuration with that
   * said on it, rather than an empty incident list somebody would read as "nothing is wrong".
   */
  const id = await create(page, 'Policy account');
  await page.goto(`/en/accounts/${id}/alert-policies`);
  const main = await page.locator('main').innerText();

  expect(main).toContain('Alert policies in Policy account');
  expect(main).toContain('DigitalOcean does not report which of them are currently firing');
  // And the comparison stated outright, so nobody reads the difference as an OpsWatch gap.
  expect(main).toContain('the way it does for a Google Cloud project');
  expect(main).toContain('This page is your configuration, not the state of it');
});

test('the alert policies page belongs to DigitalOcean connections only', async ({ page }) => {
  await page.goto('/en/accounts');
  const aws = page.getByRole('link', { name: /Moto monitoring/ }).first();
  const href = (await aws.getAttribute('href')) ?? '';
  await page.goto(`/en${href.replace(/^\/en/, '')}/alert-policies`);
  await expect(page.locator('main')).toContainText('Page not found');
});
