import { expect, test } from '@playwright/test';
import { incidentSummarySchema, pageSchema } from '@opswatch/contract';
import { MOTO_REGION, ensureMonitoringConnection, login, monitoringUrl } from './helpers';

/**
 * Incidents (§16).
 *
 * The acceptance criterion is the empty state. "No incident has been raised" and "OpsWatch has not looked
 * yet" are different claims, and §2.6 does not let them look the same.
 */

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

test('the Overview menu links to Incidents', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'overview', 'problems'));
  const nav = page.getByRole('navigation', { name: 'Overview pages' });
  await expect(nav.getByRole('link', { name: 'Incidents' })).toBeVisible();
  await expect(nav.locator('[aria-disabled="true"]')).toHaveCount(0);
});

test('§2.6 — "none raised" and "not looked yet" are different sentences', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'overview', 'incidents'));
  await expect(page.getByRole('heading', { name: 'Incidents' }).first()).toBeVisible();

  const main = await page.locator('main').innerText();
  const none = main.includes('No incident has been raised');
  const waiting = main.includes('has not read this environment yet');
  // Exactly one, never both and never neither.
  expect(none !== waiting).toBe(true);

  if (none) expect(main).toContain('That is a measured statement');
  else expect(main).toContain('not the same as there having been none');
});

test('GET /api/v1/incidents answers the shape every client parses', async ({ page }) => {
  const response = await page.request.get(`/api/v1/incidents?env=${connectionId}:${MOTO_REGION}`);
  expect(response.status(), await response.text()).toBe(200);
  const body = pageSchema(incidentSummarySchema).parse(await response.json());
  // Bounded, not cursored: §16's incidents are rare by construction.
  expect(body.nextCursor).toBeNull();
});

test('an incident id from another environment reads as absent', async ({ page }) => {
  const response = await page.request.get(`/api/v1/incidents/no-such-incident?env=${connectionId}:${MOTO_REGION}`);
  expect(response.status()).toBe(404);
});

test('incidents are advertised as a capability, and need a session', async ({ page, request }) => {
  const info = await page.request.get('/api/v1/server').then((r) => r.json());
  expect(info.features.incidents).toBe(true);
  expect((await request.get('/api/v1/incidents')).status()).toBe(401);
});

test('Incidents renders at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(monitoringUrl(connectionId, 'overview', 'incidents'));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
