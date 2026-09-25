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
  for (const rule of ['Any critical problem', 'A synthetic check goes down', 'A certificate is expiring', 'An objective is burning its error budget']) {
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

test('§15.1 — a rule can be turned off and on, because they are ordinary rules', async ({ page }) => {
  await page.goto(url());
  await expect(page.getByRole('heading', { name: 'Acknowledge and tune' })).toBeVisible();

  const off = page.getByRole('button', { name: 'Turn off' }).first();
  await off.click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.reload();
  await expect(page.locator('main')).toContainText('off');

  // Left as found.
  await page.getByRole('button', { name: 'Turn on' }).first().click();
  await expect(page.getByText('Saved.')).toBeVisible();
});

test('§15.2 — the page says what acknowledging does, and what it does not', async ({ page }) => {
  await page.goto(url());
  const main = await page.locator('main').innerText();
  // Only shown when there is something to acknowledge; the sentence matters either way.
  if (main.includes('Alerts you can acknowledge')) {
    expect(main).toContain('It does not resolve it');
    expect(main).toContain('the problem is still there');
  }
});

test('THE RULING: a machine can be alerted on, as an ordinary rule beside the rest', async ({ page }) => {
  /*
   * A disk could fill on the box running somebody's Redis and the only way to find out was to open the
   * Machines page. The rule that changes that is not a second alerting system: it sits in the same
   * list, is turned off the same way, and goes through the same cooldown and acknowledgement.
   */
  await page.goto(url());
  await expect(page.locator('main')).toContainText('A machine reports trouble');

  // Not a raw key, and not English, for a French reader.
  await page.goto(url().replace('/en/', '/fr/'));
  const french = await page.locator('main').innerText();
  expect(french).toContain('Une machine signale un problème');
  expect(french).not.toMatch(/Monitoring\.|Insights\./);
});
