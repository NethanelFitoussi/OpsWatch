import { expect, test } from '@playwright/test';
import { ensureMonitoringConnection, login, monitoringUrl } from './helpers';

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

test('the rail reaches EC2, and it opens on the host map', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'overview', 'insights'));
  const rail = page.getByRole('navigation', { name: 'Main navigation' });
  await rail.getByRole('link', { name: 'Instances' }).click();
  await expect(page).toHaveURL(/\/instances\/overview$/);
  await expect(page).toHaveTitle('EC2 overview · OpsWatch');
});

test('THE RULING: a running instance with no telemetry is unknown, never green', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'instances', 'overview'));
  const main = page.locator('main');

  // moto runs the instances and publishes no CloudWatch status checks for them. There is something there
  // that could be broken and nothing saying it is not, so OpsWatch says it cannot tell.
  await expect(main).toContainText(/could not check everything/);
  await expect(main).toContainText(/2\s*Not evaluated/);
  await expect(main).not.toContainText(/1\s*Healthy/);
  // And it names what it could not read, rather than leaving the gap unexplained.
  await expect(main).toContainText(/could not read the AWS status check/);

  // THE RULING within the ruling: the line that says "0 of 1 instances healthy" must not wear a tick.
  // A green check beside that sentence is the symbol contradicting the words.
  const partial = main.getByRole('listitem').filter({ hasText: '0 of 1 instances healthy' }).first();
  await expect(partial).toBeVisible();
  const icon = partial.locator('svg').first();
  await expect(icon).toHaveClass(/text-muted-foreground/);
  await expect(icon).not.toHaveClass(/emerald/);
});

test('the host map groups by availability zone, and a tile carries its identity', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'instances', 'overview'));
  await expect(page.locator('main')).toContainText('Grouped by availability zone');
  for (const zone of ['us-east-1a', 'us-east-1b']) {
    const group = page.locator(`main section[aria-label="${zone}"]`);
    await expect(group, zone).toBeVisible();
    await expect(group.getByRole('link')).toHaveCount(1);
  }
  const tile = page.locator('main section[aria-label="us-east-1a"]').getByRole('link').first();
  await expect(tile).toHaveAttribute('title', /opswatch-e2e-host-a — Not evaluated — t3\.small, running/);
  await tile.click();
  await expect(page).toHaveURL(/\/instances\/list\?/);
});

test('the instance list says what each one is, and the search narrows it', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'instances', 'list'));
  const rows = page.locator('main tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('opswatch-e2e-host-a');
  await expect(rows.first()).toContainText('t3.small');
  await expect(rows.first()).toContainText('us-east-1a');

  await page.getByLabel('Search instances').fill('host-b');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('main tbody tr')).toHaveCount(1);
  await expect(page.locator('main tbody tr')).toContainText('opswatch-e2e-host-b');
});

test('EC2 renders at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(monitoringUrl(connectionId, 'instances', 'overview'));
  await expect(page.locator('main')).toContainText('Every instance');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
