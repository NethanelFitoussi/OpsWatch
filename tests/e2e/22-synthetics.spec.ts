import { expect, test } from '@playwright/test';
import { pageSchema, syntheticSummarySchema } from '@opswatch/contract';
import { MOTO_REGION, ensureMonitoringConnection, login, monitoringUrl } from './helpers';

/**
 * Synthetics (§14).
 *
 * Two acceptance criteria: nothing is fetched from this host until somebody enables a check, and a URL
 * pointing inside the network is refused rather than quietly attempted.
 */

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

const url = () => monitoringUrl(connectionId, 'overview', 'synthetics');

test('the Overview menu links to Synthetics', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'overview', 'problems'));
  await expect(page.getByRole('navigation', { name: 'Overview pages' }).getByRole('link', { name: 'Synthetics' })).toBeVisible();
});

test('§14 — nothing is fetched from this host until a check is enabled', async ({ page }) => {
  await page.goto(url());
  const main = await page.locator('main').innerText();
  expect(main).toContain('No check has been added');
  expect(main).toContain('Nothing is being fetched from this host until you add one and switch it on');
});

test('§14 — the rules and the guard are stated on the page, not in documentation', async ({ page }) => {
  await page.goto(url());
  const main = await page.locator('main').innerText();
  expect(main).toContain('down after two consecutive failures');
  expect(main).toContain('refuses addresses inside your network or the cloud metadata service');
  expect(main).toContain('never disables certificate verification');
});

test('THE RULING: a URL OpsWatch will not fetch is refused at save time', async ({ page }) => {
  await page.goto(url());
  await page.getByLabel('Name').fill('metadata');
  await page.getByLabel('URL').fill('file:///etc/passwd');
  await page.getByRole('button', { name: 'Save check' }).click();
  // Refused before it is stored, so it never sits in the database looking configured.
  await expect(page.getByText('use http or https on a standard port', { exact: false })).toBeVisible();
  await expect(page.locator('main')).toContainText('No check has been added');
});

test('a check can be added, shows "not yet run", and can be removed', async ({ page }) => {
  await page.goto(url());
  await page.getByLabel('Name').fill('Checkout health');
  await page.getByLabel('URL').fill('https://example.com/healthz');
  await page.getByRole('button', { name: 'Save check' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.reload();
  await expect(page.locator('main')).toContainText('Checkout health');
  // Three states, never two: a check that has never run is not up.
  await expect(page.locator('main')).toContainText('Not yet run');
  await expect(page.locator('main')).toContainText('not running');

  await page.getByRole('button', { name: 'Remove' }).first().click();
  await expect(page.locator('main')).toContainText('No check has been added');
});

test('Synthetics renders at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(url());
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('GET /api/v1/synthetics answers the shape every client parses', async ({ page }) => {
  const response = await page.request.get(`/api/v1/synthetics?env=${connectionId}:${MOTO_REGION}`);
  expect(response.status(), await response.text()).toBe(200);
  expect(pageSchema(syntheticSummarySchema).parse(await response.json()).nextCursor).toBeNull();
});

test('synthetics are advertised as a capability, and need a session', async ({ page, request }) => {
  const info = await page.request.get('/api/v1/server').then((r) => r.json());
  expect(info.features.synthetics).toBe(true);
  expect((await request.get('/api/v1/synthetics')).status()).toBe(401);
});

test('THE RULING: a check that has never run is reported as unknown, never as up', async ({ page }) => {
  await page.goto(url());
  await page.getByLabel('Name').fill('API health');
  await page.getByLabel('URL').fill('https://example.com/healthz');
  await page.getByRole('button', { name: 'Save check' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  const body = await page.request.get(`/api/v1/synthetics?env=${connectionId}:${MOTO_REGION}`).then((r) => r.json());
  const created = pageSchema(syntheticSummarySchema).parse(body).items.find((one) => one.name === 'API health');
  expect(created).toMatchObject({ status: 'unknown', availability24h: null, uptime30d: null, lastCheckedAt: null });

  // §14, REP-5: the report stops saying "not collected" the moment a check exists.
  await page.goto(monitoringUrl(connectionId, 'load-balancers', 'report'));
  await expect(page.locator('main')).toContainText('Checks run');

  await page.goto(url());
  await page.getByRole('button', { name: 'Remove' }).first().click();
  await expect(page.locator('main')).toContainText('No check has been added');
});

test('§14, REP-5 — with no check configured the report says so, rather than showing nothing', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'load-balancers', 'report'));
  const main = await page.locator('main').innerText();
  expect(main).toContain('Synthetics');
  // "Nobody set one up" and "everything passed" are different answers.
  expect(main).toContain('Nothing is configured to collect this');
});
