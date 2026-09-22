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
  // Queries and Report are both built, so the menu links to both and carries the range across.
  await expect(nav.getByRole('link', { name: 'Queries' })).toHaveAttribute('href', `/en/c/${connectionId}/us-east-1/databases/queries?range=12h`);
  await expect(nav.getByRole('link', { name: 'Report' })).toHaveAttribute('href', `/en/c/${connectionId}/us-east-1/databases/report?range=12h`);
  await expect(page.getByRole('heading', { level: 1, name: 'Instances' })).toBeVisible();
});

test('a sub-page no task has built is disabled, and nothing in the menu links to it', async ({ page }) => {
  // Overview is fully built now, so the treatment is shown where it is still true: Logs.
  await page.goto(`/en/c/${connectionId}/us-east-1/logs/search`);
  const nav = page.getByRole('navigation', { name: 'Logs pages' });
  await expect(nav.getByRole('link', { name: 'Search' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.locator('[aria-disabled="true"]').filter({ hasText: 'Volume' })).toContainText('Coming soon');
  await expect(nav.locator('a[href*="/logs/volume"]')).toHaveCount(0);
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

test('the databases queries page names its scope and lists the instances it could not cover', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/databases/queries?range=3h`);
  await expect(page).toHaveTitle('Queries · OpsWatch');
  await expect(page.getByRole('heading', { level: 1, name: 'Queries' })).toBeVisible();
  // moto never reports PerformanceInsightsEnabled, so the seeded instance is always "not covered".
  await expect(page.getByText("These are the statements visible in each instance's top 25", { exact: false })).toBeVisible();
  await expect(page.getByText('Covering 0 of 1 database instances.')).toBeVisible();
  const notCovered = page.getByRole('heading', { name: 'Instances not covered' });
  await expect(notCovered).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'opswatch-e2e-db' })).toContainText('Performance Insights is disabled');
  await expect(page.getByText('No statement was returned for the instances that could be read.')).toBeVisible();
});

test('the grouping and the sort ride in the URL and keep the range', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/databases/queries?range=3h`);
  await expect(page.getByRole('link', { name: 'Statements' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'Database users' })).toHaveAttribute('href', `/en/c/${connectionId}/us-east-1/databases/queries?range=3h&group=user`);
  await page.getByRole('link', { name: 'Most instances affected' }).click();
  await expect(page).toHaveURL(`/en/c/${connectionId}/us-east-1/databases/queries?range=3h&sort=instances`);
  await expect(page.getByRole('link', { name: 'Most instances affected' })).toHaveAttribute('aria-current', 'page');
});

test('the section menu reaches the queries page from the instances list', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/us-east-1/databases/instances?range=12h`);
  await page.getByRole('navigation', { name: 'Databases pages' }).getByRole('link', { name: 'Queries' }).click();
  await expect(page).toHaveURL(`/en/c/${connectionId}/us-east-1/databases/queries?range=12h`);
});
