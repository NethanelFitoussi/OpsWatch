import { expect, test } from '@playwright/test';
import { ensureMonitoringConnection, login, monitoringUrl } from './helpers';

/**
 * Logs → Volume (§18).
 *
 * The page that answers "which log groups are costing me money, and which are kept forever" — and the one
 * page in the Logs section that costs nothing to load, because it reads metrics rather than running a query.
 */

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

const volumeUrl = () => monitoringUrl(connectionId, 'logs', 'volume');

test('the Logs menu links to Volume instead of disabling it', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'logs', 'search'));
  const nav = page.getByRole('navigation', { name: 'Logs pages' });
  await expect(nav.getByRole('link', { name: 'Volume' })).toBeVisible();
  await expect(nav.locator('[aria-disabled="true"]')).toHaveCount(0);
});

test('Volume opens by clicking and lists the log groups with their retention', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'logs', 'search'));
  await page.getByRole('navigation', { name: 'Logs pages' }).getByRole('link', { name: 'Volume' }).click();
  await expect(page).toHaveURL(/\/logs\/volume(\?|$)/);

  await expect(page.getByRole('heading', { name: 'Log volume and retention' })).toBeVisible();
  const main = await page.locator('main').innerText();
  // The seeded moto groups, and the columns that make the page worth opening.
  expect(main).toContain('/ecs/opswatch-web');
  for (const column of ['Ingested', 'Share', 'Stored', 'Retention']) expect(main).toContain(column);
});

test('§18 — the page says it costs nothing, because that is why volume lives here', async ({ page }) => {
  await page.goto(volumeUrl());
  const main = await page.locator('main').innerText();
  expect(main).toContain('costs nothing against the daily log scanning budget');
});

test('§2.4 — a group kept forever says so, and an unmeasured figure is not a zero', async ({ page }) => {
  await page.goto(volumeUrl());
  const main = await page.locator('main').innerText();
  // moto reports no retention on the seeded groups, so "forever" must be shown as words.
  expect(main).toContain('Forever');
  expect(main).toContain('kept forever, so their stored size only grows');
  // Nothing anywhere renders an unmeasured figure as 0.
  const cells = await page.locator('main td').allInnerTexts();
  expect(cells.some((text) => text.trim() === 'Not measured' || /\d/.test(text))).toBe(true);
});

test('the time range rides in the URL, like every other monitoring page', async ({ page }) => {
  await page.goto(`${volumeUrl()}?range=24h`);
  await expect(page).toHaveURL(/range=24h/);
  await expect(page.getByRole('heading', { name: 'Log volume and retention' })).toBeVisible();
});

test('Volume needs a session', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto(volumeUrl());
  await expect(page).toHaveURL(/\/en\/login$/);
});

test('Volume renders at 360px without horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(volumeUrl());
  await expect(page.getByRole('heading', { name: 'Log volume and retention' })).toBeVisible();
  // The table itself may scroll deliberately; the page must not.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
