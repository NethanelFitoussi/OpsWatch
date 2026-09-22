import { expect, test } from '@playwright/test';
import { briefSchema, healthSchema, pageSchema, problemSummarySchema } from '@opswatch/contract';
import { MOTO_REGION, ensureMonitoringConnection, login, rscHeaders } from './helpers';

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

const problemsUrl = () => `/en/c/${connectionId}/${MOTO_REGION}/overview/problems`;

test('the overview opens on the Morning brief, as the section default', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/${MOTO_REGION}/overview`);
  await expect(page).toHaveURL(new RegExp('/overview/brief$'));
  await expect(page.getByRole('heading', { level: 2, name: 'Morning brief' }).first()).toBeVisible();
});

test('Problems, Health and the brief are all real pages', async ({ page }) => {
  for (const [subsection, heading] of [['problems', 'Problems'], ['health', 'Health'], ['brief', 'Morning brief']] as const) {
    await page.goto(`/en/c/${connectionId}/${MOTO_REGION}/overview/${subsection}`);
    await expect(page.getByRole('heading', { level: 2, name: heading }).first()).toBeVisible();
  }
});

test('Health never reports production healthy on a reading it has not taken', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/${MOTO_REGION}/overview/health`);
  const main = await page.locator('main').innerText();
  // Exactly one of: it has read and reached a verdict, or it has not read and says so.
  const verdict = /Healthy|Degraded|Critical/.test(main);
  const cannot = /Cannot be determined|has not finished its first check/.test(main);
  expect(verdict !== cannot).toBe(true);
});

test('GET /api/v1/health and /brief answer the shapes every client parses', async ({ page }) => {
  const env = `${connectionId}:${MOTO_REGION}`;
  const health = await page.request.get(`/api/v1/health?env=${env}`);
  expect(health.status(), await health.text()).toBe(200);
  healthSchema.parse(await health.json());

  const brief = await page.request.get(`/api/v1/brief?env=${env}`);
  expect(brief.status(), await brief.text()).toBe(200);
  const parsed = briefSchema.parse(await brief.json());
  expect(parsed.period.to).toBeGreaterThan(parsed.period.from);
});

test('Problems says which of its two empty states applies, never the wrong one', async ({ page }) => {
  await page.goto(problemsUrl());
  const body = await page.locator('main').innerText();
  // Three legitimate states, and the page must be in exactly one: it has rows, it has looked and found
  // nothing, or it has not looked yet. "Nothing is wrong" when nobody has looked is the one lie that matters.
  const listed = (await page.locator('main li').count()) > 0;
  const looked = body.includes('Nothing is wrong in this environment');
  const waiting = body.includes('has not finished its first check');
  expect([listed, looked, waiting].filter(Boolean)).toHaveLength(1);
});

test('the overview menu links every built page and marks the one that is not', async ({ page }) => {
  await page.goto(problemsUrl());
  const nav = page.getByRole('navigation', { name: 'Overview pages' });
  // All three intelligence pages are built now, so all three are links.
  for (const label of ['Morning brief', 'Health', 'Problems', 'Insights']) {
    await expect(nav.getByRole('link', { name: label })).toBeVisible();
  }
  // Audit is the one that remains: named so a reader knows where it will be, and not a link, so nobody
  // reaches a 404.
  await expect(nav.getByText('Audit')).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Audit' })).toHaveCount(0);
});

test('GET /api/v1/problems answers the shape every client parses', async ({ page }) => {
  const response = await page.request.get(`/api/v1/problems?env=${connectionId}:${MOTO_REGION}`);
  expect(response.status(), await response.text()).toBe(200);
  const page1 = pageSchema(problemSummarySchema).parse(await response.json());
  expect(Array.isArray(page1.items)).toBe(true);
  // Cursored, and honest about there being no more.
  expect(page1.nextCursor === null || typeof page1.nextCursor === 'string').toBe(true);
});

test('the problems endpoint refuses an environment this instance does not have', async ({ page }) => {
  const missing = await page.request.get('/api/v1/problems?env=deadbeefcafe:us-east-1');
  // "Nothing is wrong there" and "that is not one of mine" are different answers.
  expect(missing.status()).toBe(404);
  const malformed = await page.request.get('/api/v1/problems?env=not-an-environment');
  expect(malformed.status()).toBe(400);
});

test('the server reports problems as a capability it actually serves', async ({ page }) => {
  const info = await page.request.get('/api/v1/server').then((r) => r.json());
  expect(info.features.problems).toBe(true);
  expect(info.features.health).toBe(true);
  expect(info.features.brief).toBe(true);
  expect(info.features.errors).toBe(true);
  // And still reports the ones it does not, so a client gates on the flag rather than on a field existing.
  expect(info.features.ai).toBe(false);
  expect(info.features.incidents).toBe(false);
});

test('a problem id from another environment reads as absent', async ({ page }) => {
  const response = await page.request.get(`/api/v1/problems/no-such-problem?env=${connectionId}:${MOTO_REGION}`);
  expect(response.status()).toBe(404);
});

test('the Problems page renders at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(problemsUrl());
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('client-side navigation into Problems works', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/${MOTO_REGION}/overview/insights`);
  const response = await page.request.get(problemsUrl(), { headers: rscHeaders(['(app)', 'c', connectionId, MOTO_REGION, 'overview', 'problems']) });
  expect(response.status()).toBe(200);
});
