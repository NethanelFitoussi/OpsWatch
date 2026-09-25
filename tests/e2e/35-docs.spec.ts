import { expect, test } from '@playwright/test';
import { ensureMonitoringConnection, login, monitoringUrl } from './helpers';

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('the rail reaches the documentation, and every category has guides', async ({ page }) => {
  await page.goto('/en/overview');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Documentation' }).click();
  await expect(page).toHaveURL(/\/en\/docs$/);
  for (const heading of ['Getting started', 'AWS', 'Infrastructure', 'Code', 'Data and alerts', 'Other integrations']) {
    await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
  }
  // Seventeen guides, each a card with a link.
  await expect(page.locator('main a[href*="/docs/"]')).toHaveCount(23);
});

test('THE RULING: search finds a guide from words the guide does not use', async ({ page }) => {
  await page.goto('/en/docs');
  await page.getByLabel('Search the documentation').fill('save metrics');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('main')).toContainText('Keep history and build baselines');

  await page.getByLabel('Search the documentation').fill('why warning');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('main')).toContainText(/Green, amber, red/);
});

test('a guide has the six parts, every time', async ({ page }) => {
  await page.goto('/en/docs/kubernetes');
  const main = page.locator('main');
  await expect(page).toHaveTitle('Monitor Kubernetes on EKS · OpsWatch');
  for (const heading of ['What this does', 'Before you start', 'Steps', 'How to verify', 'Common problems', 'Next step']) {
    await expect(main.getByRole('heading', { level: 2, name: heading }), heading).toBeVisible();
  }
  // The command is there to be copied, not retyped.
  await expect(main).toContainText('amazon-cloudwatch-observability');
  await expect(main.getByRole('button', { name: 'Copy' }).first()).toBeVisible();
  // And it is honest about the collector it does not ship.
  await expect(main).toContainText(/we will not pretend it exists/);
});

test('THE RULING: every guide renders its prose, in English and in French', async ({ page }) => {
  for (const locale of ['en', 'fr'] as const) {
    await page.goto(`/${locale}/docs`);
    const links = await page.locator('main a[href*="/docs/"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
    expect(links.length, locale).toBe(23);
    for (const href of links) {
      await page.goto(href);
      const body = await page.locator('main').innerText();
      // A missing message renders its own key, which is the failure this catches.
      expect(body, href).not.toMatch(/Docs\.guides\./);
      expect(body.length, href).toBeGreaterThan(400);
    }
  }
});

test('a dead end offers the way out of it', async ({ page }) => {
  const connectionId = await ensureMonitoringConnection(page);
  // History is off in this stack, so the problem chart says so — and links to the guide that explains it.
  await page.goto(monitoringUrl(connectionId, 'overview', 'problems'));
  const first = page.locator('main a[href*="/overview/problems/"]').first();
  test.skip((await first.count()) === 0, 'no problem in this environment to read');
  await first.click();
  await expect(page.locator('main')).toContainText('Historical collection is off');
  await page.getByRole('link', { name: 'How history works' }).click();
  await expect(page).toHaveURL(/\/docs\/history$/);
});

test('the documentation renders at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const path of ['/en/docs', '/en/docs/redis']) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
