import { expect, test } from '@playwright/test';
import { alert, ensureMonitoringConnection, login, monitoringUrl } from './helpers';

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

test('the settings page opens from the rail and shows what the interval costs', async ({ page }) => {
  await page.goto('/en/accounts');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/en\/settings$/);
  await expect(page).toHaveTitle('Settings · OpsWatch');
  await expect(page.getByLabel('Refresh interval')).toHaveValue('120000');
  await expect(page.getByLabel('Default time range')).toHaveValue('3h');
  // The cost sentence is computed, not written down: two minutes is 1,800 metrics an hour.
  await expect(page.getByText(/about 1,800 metrics per hour/)).toBeVisible();
  await page.getByLabel('Refresh interval').selectOption('0');
  await expect(page.getByText('Off costs nothing beyond the metrics of the first page load.')).toBeVisible();
});

test('an interval the page does not offer is refused with a message, and nothing is saved', async ({ page }) => {
  await page.goto('/en/settings');
  // A crafted value: the page itself only ever offers the six intervals.
  await page.getByLabel('Refresh interval').evaluate((element: HTMLSelectElement) => {
    element.append(new Option('45 seconds', '45000'));
    element.value = '45000';
  });
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(alert(page)).toContainText('Choose one of the offered refresh intervals.');
  await page.reload();
  await expect(page.getByLabel('Refresh interval')).toHaveValue('120000');
});

test('the chosen interval and range are saved, survive a reload and reach the monitoring pages', async ({ page }) => {
  await page.goto('/en/settings');
  await page.getByLabel('Refresh interval').selectOption('30000');
  await page.getByLabel('Default time range').selectOption('12h');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved.');

  await page.reload();
  await expect(page.getByLabel('Refresh interval')).toHaveValue('30000');
  await expect(page.getByLabel('Default time range')).toHaveValue('12h');

  await page.goto(monitoringUrl(connectionId, 'containers', 'services'));
  await expect(page.getByText('Refreshes every 30 s')).toBeVisible();
  // A page without ?range now opens on the configured default; the address bar still wins.
  await expect(page.getByRole('navigation', { name: 'Time range' }).getByRole('link', { name: '12 h' })).toHaveAttribute('aria-current', 'page');
  await page.goto(`${monitoringUrl(connectionId, 'containers', 'services')}?range=1h`);
  await expect(page.getByRole('navigation', { name: 'Time range' }).getByRole('link', { name: '1 h' })).toHaveAttribute('aria-current', 'page');

  // Off removes the timer entirely: there is nothing left to pause.
  await page.goto('/en/settings');
  await page.getByLabel('Refresh interval').selectOption('0');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.goto(monitoringUrl(connectionId, 'alarms', 'list'));
  await expect(page.getByText('Auto-refresh off')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause auto-refresh' })).toHaveCount(0);
});

test('fits a 360 px viewport with no sideways scroll and every control reachable', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/en/settings');
  // Reachable, not merely visible: both selects and the save button actually work at this width.
  await page.getByLabel('Refresh interval').selectOption('30000');
  await page.getByLabel('Default time range').selectOption('12h');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved.');
  const root = page.locator('html');
  expect(await root.evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(await root.evaluate((el) => el.clientWidth));
});
