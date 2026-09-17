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

test('the alarms page hides target-tracking alarms until asked', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'alarms'));
  await expect(page).toHaveTitle('Alarms · OpsWatch');
  const high = page.getByRole('row').filter({ hasText: 'opswatch-e2e-high-cpu' });
  await expect(high).toContainText('In alarm');
  await expect(page.getByRole('row').filter({ hasText: 'TargetTracking-service/opswatch-e2e/web-AlarmHigh-e2e' })).toHaveCount(0);
  await expect(page.getByText('1 target-tracking alarm is hidden.')).toBeVisible();
  await page.getByRole('link', { name: 'Show them' }).click();
  await expect(page).toHaveURL(/tt=1/);
  await expect(page.getByRole('row').filter({ hasText: 'TargetTracking-service/opswatch-e2e/web-AlarmHigh-e2e' })).toBeVisible();
});

test('the state filter keeps only alarms in alarm', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'alarms'));
  await expect(page.getByRole('row').filter({ hasText: 'opswatch-e2e-db-connections' })).toContainText('OK');
  await page.getByLabel('State').selectOption('ALARM');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/state=ALARM/);
  await expect(page.getByRole('row').filter({ hasText: 'opswatch-e2e-high-cpu' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'opswatch-e2e-db-connections' })).toHaveCount(0);
});

test('the containers page lists the seeded service with its task counts and sparklines', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'containers'));
  await expect(page).toHaveTitle('Containers · OpsWatch');
  await expect(page.getByRole('heading', { level: 2, name: 'opswatch-e2e', exact: true })).toBeVisible();
  await expect(page.getByText('Container Insights on')).toBeVisible();
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'web', exact: true }) });
  // moto starts no task (fact 6): 0 running, 2 pending, deployment in progress.
  await expect(row).toContainText('0/2 running · 2 pending');
  await expect(row).toContainText('In progress');
  await expect(row.getByRole('img', { name: /^CPU utilization over the selected period/ })).toBeVisible();
});

test('the time range is kept in the URL', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'containers'));
  await page.getByRole('navigation', { name: 'Time range' }).getByRole('link', { name: '12 h' }).click();
  await expect(page).toHaveURL(/range=12h/);
  await expect(page.getByRole('navigation', { name: 'Time range' }).getByRole('link', { name: '12 h' })).toHaveAttribute('aria-current', 'page');
});

test('the service page shows charts, target health and the log group', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'containers'));
  await page.getByRole('link', { name: 'web', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${connectionId}/us-east-1/containers/opswatch-e2e/web`));
  await expect(page.getByRole('figure', { name: 'CPU utilization' }).locator('.recharts-line-curve')).toHaveCount(1);
  await expect(page.getByRole('figure', { name: 'Tasks' }).locator('.recharts-line-curve')).toHaveCount(2);
  await expect(page.getByRole('heading', { level: 3, name: /opswatch-e2e-web/ })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '10.0.1.10:80' })).toContainText('healthy');
  await expect(page.getByText('/ecs/opswatch-web')).toBeVisible();
  // moto gaps (facts 2 and 6): no running task, no p95.
  await expect(page.getByText('No running tasks.')).toBeVisible();
  await expect(page.getByText('The p95 response time could not be read.')).toBeVisible();
});
