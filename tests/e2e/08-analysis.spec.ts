import { expect, test } from '@playwright/test';
import { MONITORING_CONNECTION, ensureMonitoringConnection, login } from './helpers';

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

test('a section root opens its first sub-page and keeps the time range', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/databases?range=12h`);
  await expect(page).toHaveURL(`/en/c/${connectionId}/us-east-1/databases/instances?range=12h`);
  // Logs lands on Search, the sub-page it has always had; the dashboard takes over only once it exists.
  await page.goto(`/en/c/${connectionId}/us-east-1/logs`);
  await expect(page).toHaveURL(`/en/c/${connectionId}/us-east-1/logs/search`);
});

test('the section menu lists the sub-pages, marks the active one and keeps the region and range', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/databases/instances?range=12h`);
  const nav = page.getByRole('navigation', { name: 'Databases pages' });
  await expect(nav.getByRole('link', { name: 'Instances' })).toHaveAttribute('aria-current', 'page');
  // Queries and Report arrive in later tasks: until then the menu shows where they will be, disabled.
  await expect(nav.getByRole('link', { name: 'Queries' })).toHaveCount(0);
  await expect(nav.locator('[aria-disabled="true"]').filter({ hasText: 'Queries' })).toContainText('Coming soon');
  await expect(nav.locator('[aria-disabled="true"]').filter({ hasText: 'Report' })).toContainText('Coming soon');
  await expect(page.getByRole('heading', { level: 1, name: 'Instances' })).toBeVisible();
});

test('a sub-page no task has built is disabled, and nothing in the menu links to it', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/overview/insights`);
  const nav = page.getByRole('navigation', { name: 'Overview pages' });
  await expect(nav.getByRole('link', { name: 'Insights' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.locator('[aria-disabled="true"]').filter({ hasText: 'Audit' })).toContainText('Coming soon');
  await expect(nav.locator('a[href*="/overview/audit"]')).toHaveCount(0);
});

test('the breadcrumb names the section, the connection and the sub-page', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/containers/services`);
  const crumb = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(crumb).toContainText('Containers');
  await expect(crumb).toContainText(MONITORING_CONNECTION);
  await expect(crumb).toContainText('Services');
});

test('the section menu is a scrollable strip at 360 px and nothing overflows', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/en/c/${connectionId}/us-east-1/logs/search`);
  const nav = page.getByRole('navigation', { name: 'Logs pages' });
  // Volume and Endpoints have no page yet, so the strip shows them disabled rather than linking to a 404.
  await expect(nav.locator('[aria-disabled="true"]').filter({ hasText: 'Volume' })).toBeVisible();
  await expect(nav.locator('[aria-disabled="true"]').filter({ hasText: 'Endpoints' })).toBeVisible();
  const root = page.locator('html');
  expect(await root.evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(await root.evaluate((el) => el.clientWidth));
});

test('the section menu sits at the far left of the content and has no collapse of its own', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/en/c/${connectionId}/us-east-1/alarms/list`);
  const nav = page.getByRole('navigation', { name: 'Alarms pages' });
  // The rail is what collapses, with one control at its foot; the section menu never does.
  await expect(page.getByRole('button', { name: 'Collapse the section menu' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Alarms' })).toHaveAttribute('href', `/en/c/${connectionId}/us-east-1/alarms/list`);

  // Flush against the rail: the menu's column starts exactly where the rail ends, with no gap.
  const railRight = await page.locator('aside').evaluate((el) => el.getBoundingClientRect().right);
  const menuLeft = await nav.evaluate((el) => (el.parentElement as HTMLElement).getBoundingClientRect().left);
  expect(Math.abs(menuLeft - railRight)).toBeLessThanOrEqual(1);
});

test('a page fills the width of the screen, with no centred column and no horizontal scrollbar', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto(`/en/c/${connectionId}/us-east-1/alarms/list`);
  const width = (locator: ReturnType<typeof page.locator>) => locator.evaluate((el) => el.getBoundingClientRect().width);
  expect((await width(page.locator('main'))) + (await width(page.locator('aside')))).toBeGreaterThanOrEqual(1919);
  // The table takes the width it gains instead of stopping at a maximum.
  const tableRight = await page.getByRole('table').first().evaluate((el) => el.getBoundingClientRect().right);
  expect(tableRight).toBeGreaterThan(1800);
  const root = page.locator('html');
  expect(await root.evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(await root.evaluate((el) => el.clientWidth));
});

test('the main rail collapses to icons and is remembered', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/en/c/${connectionId}/us-east-1/overview/insights`);
  await page.getByRole('button', { name: 'Collapse the menu' }).click();
  await page.reload();
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: 'Containers' })).toBeVisible(); // the sr-only label keeps the name
  await expect(page.getByRole('button', { name: 'Expand the menu' })).toHaveAttribute('aria-pressed', 'true');
});

test('switching region keeps the sub-page', async ({ page }) => {
  // The monitoring connection has one region, so this asserts the link the selector renders, not a navigation.
  await page.goto(`/en/c/${connectionId}/us-east-1/databases/instances?range=12h`);
  await page.getByRole('button', { name: 'Region' }).click();
  // The menu item is the link itself: DropdownMenuItem renders as its child.
  await expect(page.getByRole('menuitem', { name: 'us-east-1' })).toHaveAttribute('href', `/en/c/${connectionId}/us-east-1/databases/instances?range=12h`);
});
