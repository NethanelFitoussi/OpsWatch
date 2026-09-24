import { expect, test } from '@playwright/test';
import { ensureMonitoringConnection, login, monitoringUrl } from './helpers';

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

test('the rail reaches Redis, and it opens on the cluster map', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'overview', 'insights'));
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Redis' }).click();
  await expect(page).toHaveURL(/\/redis\/overview$/);
  await expect(page).toHaveTitle('Redis overview · OpsWatch');
});

test('THE RULING: Redis is found through CloudWatch, and the page says what that cannot see', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'redis', 'overview'));
  const main = page.locator('main');

  // Two seeded nodes of one cluster, discovered without any permission beyond the ones the role has.
  await expect(main.locator('section[aria-label="opswatch-e2e-cache"]')).toBeVisible();
  await expect(main.getByRole('link', { name: /0001 — Healthy/ })).toHaveCount(1);
  // The hot node crosses AWS's own engine-CPU warning threshold, so it is amber rather than green.
  await expect(main.getByRole('link', { name: /0002 — Needs attention/ })).toHaveCount(1);

  // THE RULING within the ruling: the busiest-node bar must not be green at 83% when the verdict beside
  // it is amber. Magnitude is not severity, and a bar coloured by a generic fraction said otherwise.
  const hot = main.getByRole('listitem').filter({ hasText: '0002' }).last();
  await expect(hot.locator('span[style*="width"]')).toHaveClass(/amber/);

  // And the cost of finding it this way is stated on the page, not buried in a manual.
  await expect(main).toContainText('What this view cannot see');
  await expect(main).toContainText(/no engine version, node type, endpoint or replication topology/);
});

test('the node table shows what is judged and what is only shown', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'redis', 'nodes'));
  const rows = page.locator('main tbody tr');
  await expect(rows).toHaveCount(2);

  const hot = rows.filter({ hasText: '0002' });
  await expect(hot).toContainText('Needs attention');
  // Engine CPU is the verdict; the hit rate beside it is a fact with no verdict attached.
  await expect(hot).toContainText('90%');

  await page.getByLabel('Search nodes').fill('0001');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('main tbody tr')).toHaveCount(1);
});

test('the Redis pages render at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const subsection of ['overview', 'nodes'] as const) {
    await page.goto(monitoringUrl(connectionId, 'redis', subsection));
    await expect(page.locator('main')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, subsection).toBeLessThanOrEqual(0);
  }
});
