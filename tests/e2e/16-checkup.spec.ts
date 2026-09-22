import { expect, test } from '@playwright/test';
import { ensureMonitoringConnection, login, monitoringUrl } from './helpers';

/**
 * Checkup (Stage 3 §4, renamed by the intelligence spec).
 *
 * The acceptance criterion is §2.6's: the page must state how much of its catalogue actually ran, and name
 * the checks that could not, rather than presenting a short findings list as a clean bill of health.
 */

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

test('the Overview menu links to Checkup, and no longer says Audit', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'overview', 'insights'));
  const nav = page.getByRole('navigation', { name: 'Overview pages' });
  await expect(nav.getByRole('link', { name: 'Checkup' })).toBeVisible();
  // "Audit" now means the administrative audit log, so it must not name this page.
  await expect(nav.getByRole('link', { name: 'Audit' })).toHaveCount(0);
  await expect(nav.locator('[aria-disabled="true"]')).toHaveCount(0);
});

test('Checkup opens by clicking and states its own coverage before its findings', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'overview', 'insights'));
  await page.getByRole('navigation', { name: 'Overview pages' }).getByRole('link', { name: 'Checkup' }).click();
  await expect(page).toHaveURL(/\/overview\/checkup$/);

  const main = await page.locator('main').innerText();
  expect(main).toMatch(/\d+ of \d+ checks ran\./);
  expect(main).toMatch(/\d+ could not\./);
});

test('§2.6 — the checks that could not run are on the page, not dropped from it', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'overview', 'checkup'));
  const main = await page.locator('main').innerText();

  expect(main).toContain('Checks that could not run');
  // Named individually, each with why, so the reader can see what was not looked at.
  expect(main).toContain('Log groups with no retention setting');
  expect(main).toContain('OpsWatch does not collect the data this check reads yet');
});

test('a fresh environment is told what is not set up, worst first, with what to do', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'overview', 'checkup'));
  const main = await page.locator('main').innerText();

  // On a connection nobody has enabled anything for, these are true and must be said.
  expect(main).toContain('No log group is switched on');
  expect(main).toContain('Historical collection is off');
  // Every finding carries its remedy, which is what separates a finding from a complaint.
  expect(main).toContain('Choose the log groups to read in Errors, Log sources.');

  // Worst first: the first severity badge on the page is the highest one present.
  const badges = await page.locator('main [data-slot="badge"], main span').allInnerTexts();
  const severities = badges.filter((text) => ['Critical', 'Warning', 'Information'].includes(text.trim()));
  const rank = { Critical: 0, Warning: 1, Information: 2 } as Record<string, number>;
  const ranks = severities.map((text) => rank[text.trim()] ?? 99);
  expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
});

test('Checkup explains how a finding differs from a problem', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'overview', 'checkup'));
  const main = await page.locator('main').innerText();
  expect(main).toContain('stays until someone changes a setting');
});

test('Checkup redirects an unauthenticated visitor to login', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto(monitoringUrl(connectionId, 'overview', 'checkup'));
  await expect(page).toHaveURL(/\/en\/login$/);
});

test('Checkup renders at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(monitoringUrl(connectionId, 'overview', 'checkup'));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
