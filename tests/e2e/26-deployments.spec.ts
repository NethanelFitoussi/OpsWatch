import { expect, test } from '@playwright/test';
import { deploymentSummarySchema, pageSchema } from '@opswatch/contract';
import { MOTO_REGION, ensureMonitoringConnection, login, monitoringUrl } from './helpers';

/**
 * What shipped (DEP-3).
 *
 * The acceptance criterion is the empty state. A deployment history that has recorded nothing must not read
 * as "nothing shipped" — before the collector has run, OpsWatch does not know what shipped, and the page has
 * to say which of the two it means (§2.6).
 */

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

const url = () => monitoringUrl(connectionId, 'containers', 'deployments');

test('the Containers menu links to Deployments', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'containers', 'services'));
  await expect(page.getByRole('navigation', { name: 'Containers pages' }).getByRole('link', { name: 'Deployments' })).toBeVisible();
});

test('THE RULING: an empty history says which silence it is, and what it does not cover', async ({ page }) => {
  await page.goto(url());
  const main = await page.locator('main').innerText();
  // By this point earlier specs have had the collector read this environment, so the empty list is a
  // measured statement — and the page says which of the two silences it is rather than leaving it blank.
  expect(main).toContain('That is a measured statement');
  expect(main).not.toContain('has not read this environment yet');
  // And it is explicit that its history starts where collection did, so the silence is not retrospective.
  expect(main).toContain('remembers deployments from the moment the collector first ran');
  expect(main).toContain('not because it did not happen');
});

test('the page says it costs nothing to open', async ({ page }) => {
  await page.goto(url());
  expect(await page.locator('main').innerText()).toContain('makes no AWS request');
});

test('GET /api/v1/deployments answers the shape every client parses', async ({ page }) => {
  const response = await page.request.get(`/api/v1/deployments?env=${connectionId}:${MOTO_REGION}`);
  expect(response.status(), await response.text()).toBe(200);
  const body = pageSchema(deploymentSummarySchema).parse(await response.json());
  // Nothing recorded yet, which a client must read as "not collected" rather than "nothing shipped".
  expect(body.items).toEqual([]);
  expect(body.nextCursor).toBeNull();
});

test('a deployment from another environment reads as absent', async ({ page }) => {
  const response = await page.request.get(`/api/v1/deployments/nope?env=${connectionId}:${MOTO_REGION}`);
  expect(response.status()).toBe(404);
});

test('deployments are advertised as a capability, and need a session', async ({ page, request }) => {
  const info = await page.request.get('/api/v1/server').then((r) => r.json());
  expect(info.features.deployments).toBe(true);
  expect((await request.get('/api/v1/deployments')).status()).toBe(401);
});

test('Deployments renders at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(url());
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
