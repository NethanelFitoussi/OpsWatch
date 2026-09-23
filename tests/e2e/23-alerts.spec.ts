import { expect, test } from '@playwright/test';
import { alertSummarySchema, pageSchema } from '@opswatch/contract';
import { MOTO_REGION, ensureMonitoringConnection, login, monitoringUrl } from './helpers';

/**
 * Alerts (§15).
 *
 * The acceptance criterion is §15's promise: installing OpsWatch never sends anything outside the instance.
 * That has to be visible on the page, not buried in documentation.
 */

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

const url = () => monitoringUrl(connectionId, 'overview', 'alerts');

test('the Overview menu links to Alerts', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'overview', 'problems'));
  await expect(page.getByRole('navigation', { name: 'Overview pages' }).getByRole('link', { name: 'Alerts' })).toBeVisible();
});

test('§15 — the page says nothing leaves this instance', async ({ page }) => {
  await page.goto(url());
  const main = await page.locator('main').innerText();
  expect(main).toContain('Alerts stay inside this instance');
  expect(main).toContain('no email, no Slack message and no webhook');
});

test('§15.1 — the install rules are visible, not hidden', async ({ page }) => {
  await page.goto(url());
  const main = await page.locator('main').innerText();
  for (const rule of ['Any critical problem', 'A synthetic check goes down', 'A certificate is expiring']) {
    expect(main, rule).toContain(rule);
  }
  // And each says its cooldown, so the quiet is a stated number rather than a surprise.
  expect(main).toMatch(/\d+ min cooldown/);
});

test('§2.6 — "none raised" and "not looked yet" are different sentences', async ({ page }) => {
  await page.goto(url());
  const main = await page.locator('main').innerText();
  const none = main.includes('No alert has been raised');
  const waiting = main.includes('has not read this environment yet');
  expect(none !== waiting).toBe(true);
});

test('GET /api/v1/alerts answers the shape every client parses', async ({ page }) => {
  const response = await page.request.get(`/api/v1/alerts?env=${connectionId}:${MOTO_REGION}`);
  expect(response.status(), await response.text()).toBe(200);
  const body = pageSchema(alertSummarySchema).parse(await response.json());
  expect(body.nextCursor).toBeNull();
});

test('alerts are advertised as a capability, and need a session', async ({ page, request }) => {
  const info = await page.request.get('/api/v1/server').then((r) => r.json());
  expect(info.features.alerts).toBe(true);
  expect((await request.get('/api/v1/alerts')).status()).toBe(401);
});

test('Alerts renders at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(url());
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
