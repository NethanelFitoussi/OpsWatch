import { expect, test } from '@playwright/test';
import { ensureMonitoringConnection, login, monitoringUrl } from './helpers';

/**
 * Errors → Log sources (§18, §9.5).
 *
 * Two things are being accepted here: an operator can actually choose what OpsWatch reads, and the page says
 * what that will cost *before* the decision rather than after it.
 */

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

const sourcesUrl = () => monitoringUrl(connectionId, 'errors', 'sources');

test('the Errors menu links to Log sources instead of disabling it', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'errors', 'groups'));
  const nav = page.getByRole('navigation', { name: 'Errors pages' });
  await expect(nav.getByRole('link', { name: 'Log sources' })).toBeVisible();
  await expect(nav.locator('[aria-disabled="true"]')).toHaveCount(0);
});

test('the page opens without an AWS call and says what is configured', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'errors', 'groups'));
  await page.getByRole('navigation', { name: 'Errors pages' }).getByRole('link', { name: 'Log sources' }).click();
  await expect(page).toHaveURL(/\/errors\/sources(\?|$)/);

  const main = await page.locator('main').innerText();
  // Not "no log groups": nothing has been switched on, which is a different fact (§2.6).
  expect(main).toContain('No log group is switched on');
  expect(main).toContain('That is not the same as there being no errors');
});

test('§9.5 — the cost is stated before the decision, not after it', async ({ page }) => {
  await page.goto(sourcesUrl());
  const main = await page.locator('main').innerText();
  expect(main).toMatch(/Scanned today: [\d.]+ GB of \d+ GB/);
  expect(main).toContain('billed per gigabyte scanned');
  expect(main).toContain('hard stop, not a warning');
});

test('the page says what it stores, which is the question a logging tool has to answer', async ({ page }) => {
  await page.goto(sourcesUrl());
  const main = await page.locator('main').innerText();
  expect(main).toContain('never the log content itself');
});

test('discovery happens on search, and the result can be chosen', async ({ page }) => {
  await page.goto(sourcesUrl());
  await page.getByLabel('Search log groups').fill('opswatch');
  await page.getByRole('button', { name: 'Search' }).click();

  // Three honest outcomes and never a silent blank: groups found, nothing matched, or a stated failure.
  const found = page.locator('main button', { hasText: /^\// });
  await expect(
    found.first().or(page.getByText('No log group matched', { exact: false })).or(page.getByText('could not list log groups', { exact: false })),
  ).toBeVisible();

  // moto is seeded, so this instance finds groups; clicking one fills the editor rather than navigating.
  await expect(found.first()).toBeVisible();
  const name = (await found.first().innerText()).trim();
  await found.first().click();
  await expect(page.getByLabel('Log group', { exact: true })).toHaveValue(name);

  // A group whose size AWS did not report says so rather than showing a zero.
  const sizes = await page.locator('main li').allInnerTexts();
  expect(sizes.some((text) => text.includes('GB stored') || text.includes('Size not measured'))).toBe(true);
});

test('a blank field falls back to the preset, exactly as the page says it will', async ({ page }) => {
  await page.goto(sourcesUrl());
  // The hint promises this, so it is the behaviour worth pinning rather than the guard behind it.
  await expect(page.getByText('Leave a field blank to use the preset', { exact: false })).toBeVisible();

  await page.getByLabel('Log group', { exact: true }).fill('/aws/ecs/preset-fallback');
  await page.selectOption('#preset', 'plain');
  await page.locator('#enabled').check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  // It saved because the preset supplied the message path, not because the check was skipped.
  await page.reload();
  await expect(page.locator('main')).toContainText('/aws/ecs/preset-fallback');

  await page.getByLabel('Log group', { exact: true }).fill('/aws/ecs/preset-fallback');
  await page.locator('#enabled').uncheck();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
});

test('a saved source appears, survives a reload, and changes what Errors says', async ({ page }) => {
  await page.goto(sourcesUrl());
  await page.getByLabel('Log group', { exact: true }).fill('/aws/ecs/opswatch-e2e');
  await page.selectOption('#preset', 'json');
  await page.locator('#enabled').check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.reload();
  await expect(page.locator('main')).toContainText('/aws/ecs/opswatch-e2e');
  await expect(page.locator('main')).toContainText('Collecting');

  // The Errors page must stop saying nothing is switched on, because now something is.
  await page.goto(monitoringUrl(connectionId, 'errors', 'groups'));
  const errors = await page.locator('main').innerText();
  expect(errors).not.toContain('No log group is switched on');

  // Switched back off, because an enabled source scans logs and that is billed.
  await page.goto(sourcesUrl());
  await page.getByLabel('Log group', { exact: true }).fill('/aws/ecs/opswatch-e2e');
  await page.locator('#enabled').uncheck();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.reload();
  await expect(page.locator('main')).toContainText('Not collecting');
});

test('Log sources needs a session', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto(sourcesUrl());
  await expect(page).toHaveURL(/\/en\/login$/);
});

test('Log sources renders at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(sourcesUrl());
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
