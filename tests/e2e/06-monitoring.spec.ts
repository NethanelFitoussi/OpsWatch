import { expect, test } from '@playwright/test';
import { MONITORING_CONNECTION, ensureMonitoringConnection, login, monitoringUrl, rscHeaders } from './helpers';

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

test('a monitoring section without a selection opens the first usable connection', async ({ page }) => {
  await page.goto('/en/overview');
  await expect(page).toHaveURL(/\/en\/c\/[0-9a-f]{12}\/us-east-1\/overview$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page).toHaveTitle('Overview · OpsWatch');
});

test('sidebar links keep the connection and region, and auto-refresh can be paused', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'overview'));
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: 'Containers' })).toHaveAttribute('href', `/en/c/${connectionId}/us-east-1/containers`);
  await expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Refreshes every 2 min')).toBeVisible();
  await page.getByRole('button', { name: 'Pause auto-refresh' }).click();
  await expect(page.getByRole('button', { name: 'Resume auto-refresh' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Auto-refresh paused')).toBeVisible();
});

test('a region the connection does not use is not found', async ({ page }) => {
  const response = await page.goto(`/en/c/${connectionId}/eu-west-3/overview`);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
});

test('an RSC request without a session leaks nothing from a monitoring page', async ({ page, playwright, baseURL }) => {
  const path = monitoringUrl(connectionId, 'overview');
  const headers = rscHeaders(['(app)', 'accounts']);
  expect(await (await page.request.get(path, { headers })).text()).toContain(MONITORING_CONNECTION);
  const anonymous = await playwright.request.newContext({ baseURL });
  expect(await (await anonymous.get(path, { headers })).text()).not.toContain(MONITORING_CONNECTION);
  await anonymous.dispose();
});
