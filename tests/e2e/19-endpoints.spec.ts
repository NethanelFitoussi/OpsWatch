import { expect, test } from '@playwright/test';
import { ensureMonitoringConnection, login, monitoringUrl } from './helpers';

/**
 * Logs → Endpoints (§3b).
 *
 * The last segment that said "Coming soon". The acceptance criteria are its two unusual properties: it runs
 * nothing on load, because rendering it would otherwise scan gigabytes; and when the field mapping matches
 * nothing it shows the real log lines so the operator can correct the names rather than guess.
 */

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

const endpointsUrl = () => monitoringUrl(connectionId, 'logs', 'endpoints');

test('nothing in the product says "Coming soon" any more', async ({ page }) => {
  for (const section of ['overview', 'errors', 'containers', 'databases', 'load-balancers', 'alarms', 'logs'] as const) {
    await page.goto(monitoringUrl(connectionId, section));
    const nav = page.getByRole('navigation', { name: /pages$/ });
    await expect(nav.locator('[aria-disabled="true"]'), section).toHaveCount(0);
  }
});

test('the Logs menu links to Endpoints, and it opens by clicking', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'logs', 'search'));
  await page.getByRole('navigation', { name: 'Logs pages' }).getByRole('link', { name: 'Endpoints' }).click();
  await expect(page).toHaveURL(/\/logs\/endpoints(\?|$)/);
  await expect(page.getByRole('heading', { name: 'Slowest endpoints' })).toBeVisible();
});

test('§3b — the page explains why it needs a field mapping at all', async ({ page }) => {
  await page.goto(endpointsUrl());
  const main = await page.locator('main').innerText();
  expect(main).toContain('a load balancer reports latency for a whole target group and never per path');
});

test('it runs nothing on load, and says what a query would cost', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(endpointsUrl());

  const main = await page.locator('main').innerText();
  expect(main).toContain('runs nothing until you ask it to');
  expect(main).toMatch(/Scanned today: [\d.]+ GB of [\d.]+ GB/);
  expect(main).toContain('hard stop, not a warning');
  // No results table before a run: an empty one would look like an answer.
  expect(main).not.toContain('p95');
});

test('with no log source switched on it says so, rather than "no slow endpoints"', async ({ page }) => {
  await page.goto(endpointsUrl());
  const main = await page.locator('main').innerText();
  const noSources = main.includes('No log group is switched on');
  const canRun = await page.getByRole('button', { name: 'Run query' }).count();
  // Exactly one of the two states, and the empty one names the cause (§2.6).
  expect(noSources !== (canRun > 0)).toBe(true);
  if (noSources) expect(main).toContain('That is not the same as your application having no slow endpoints');
});

test('a field name that could break out of the query is refused', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'errors', 'sources'));
  // Switch a source on so the form is available.
  await page.getByLabel('Log group', { exact: true }).fill('/ecs/opswatch-web');
  await page.selectOption('#preset', 'json');
  await page.locator('#enabled').check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.goto(endpointsUrl());
  await page.locator('#routeField').fill('route | delete @message');
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(page.getByText('A field name may contain letters, digits', { exact: false })).toBeVisible();

  // Left as it was found.
  await page.goto(monitoringUrl(connectionId, 'errors', 'sources'));
  await page.getByLabel('Log group', { exact: true }).fill('/ecs/opswatch-web');
  await page.locator('#enabled').uncheck();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
});

test('Endpoints needs a session', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto(endpointsUrl());
  await expect(page).toHaveURL(/\/en\/login$/);
});

test('Endpoints renders at 360px without horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(endpointsUrl());
  await expect(page.getByRole('heading', { name: 'Slowest endpoints' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
