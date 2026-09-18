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
  // Queries and Report arrive in later tasks; here the menu is asserted by the link it renders.
  await expect(nav.getByRole('link', { name: 'Queries' })).toHaveAttribute('href', `/en/c/${connectionId}/us-east-1/databases/queries?range=12h`);
  await expect(nav.getByRole('link', { name: 'Report' })).toHaveAttribute('href', `/en/c/${connectionId}/us-east-1/databases/report?range=12h`);
  await expect(page.getByRole('heading', { level: 1, name: 'Instances' })).toBeVisible();
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
  await expect(nav.getByRole('link', { name: 'Volume' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Endpoints' })).toBeVisible();
  const root = page.locator('html');
  expect(await root.evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(await root.evaluate((el) => el.clientWidth));
});

test('the section menu collapse is remembered per browser', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/en/c/${connectionId}/us-east-1/alarms/list`);
  await page.getByRole('button', { name: 'Collapse the section menu' }).click();
  const nav = page.getByRole('navigation', { name: 'Alarms pages' });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand the section menu' })).toHaveAttribute('aria-pressed', 'true');
  // Collapsed, the entry is an icon, but the sr-only label keeps naming it.
  await expect(nav.getByRole('link', { name: 'Report' })).toHaveAttribute('href', `/en/c/${connectionId}/us-east-1/alarms/report`);
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
