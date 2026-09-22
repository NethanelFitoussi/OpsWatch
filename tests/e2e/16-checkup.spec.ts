import { expect, test } from '@playwright/test';
import { checkupSchema } from '@opswatch/contract';
import { MOTO_REGION, ensureMonitoringConnection, login, monitoringUrl } from './helpers';

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

test('GET /api/v1/checkup answers what the page shows, so mobile can show it too', async ({ page }) => {
  const response = await page.request.get(`/api/v1/checkup?env=${connectionId}:${MOTO_REGION}`);
  expect(response.status(), await response.text()).toBe(200);
  const checkup = checkupSchema.parse(await response.json());

  // §2.6 on the wire: coverage is not optional, because "no findings" means nothing without it.
  expect(checkup.coverage.ran + checkup.coverage.notRun).toBe(checkup.coverage.total);
  expect(checkup.coverage.notRun).toBeGreaterThan(0);
  expect(checkup.notRun.length).toBe(checkup.coverage.notRun);

  // The findings the page shows on a fresh environment are the ones the API returns.
  const ids = checkup.findings.map((finding) => finding.id);
  expect(ids).toContain('errors_not_collected');
  expect(ids).toContain('history_off');
  // Worst first, as the server states it.
  const rank = { critical: 0, warning: 1, info: 2 } as Record<string, number>;
  const ranks = checkup.findings.map((finding) => rank[finding.severity] ?? 99);
  expect(ranks).toEqual([...ranks].sort((a, b) => a - b));

  // Placeholders, never a sentence built by the server: a client renders its own localised copy.
  for (const finding of checkup.findings) {
    for (const value of Object.values(finding.values)) expect(['string', 'number']).toContain(typeof value);
  }
});

test('checkup is advertised as a capability, and needs a session', async ({ page, request }) => {
  const info = await page.request.get('/api/v1/server').then((r) => r.json());
  expect(info.features.checkup).toBe(true);
  expect((await request.get('/api/v1/checkup')).status()).toBe(401);
});
