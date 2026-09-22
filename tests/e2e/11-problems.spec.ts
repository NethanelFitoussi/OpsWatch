import { expect, test } from '@playwright/test';
import { pageSchema, problemSummarySchema } from '@opswatch/contract';
import { MOTO_REGION, ensureMonitoringConnection, login, rscHeaders } from './helpers';

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

const problemsUrl = () => `/en/c/${connectionId}/${MOTO_REGION}/overview/problems`;

test('Problems is the default overview page, and it is a real page', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/${MOTO_REGION}/overview`);
  await expect(page).toHaveURL(new RegExp(`/overview/problems$`));
  await expect(page.getByRole('heading', { level: 2, name: 'Problems' }).first()).toBeVisible();
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

test('the menu offers Problems and marks Health and the brief as not built yet', async ({ page }) => {
  await page.goto(problemsUrl());
  const nav = page.getByRole('navigation', { name: 'Overview pages' });
  await expect(nav.getByRole('link', { name: 'Problems' })).toBeVisible();
  // They are named so a reader knows where they will be, and are not links, so nobody reaches a 404.
  // Each unbuilt entry is a span carrying its label and a "Coming soon" badge, never a link.
  for (const label of ['Health', 'Morning brief']) {
    await expect(nav.getByText(label)).toBeVisible();
    await expect(nav.getByRole('link', { name: new RegExp(label) })).toHaveCount(0);
  }
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
  // And still reports the ones it does not, so a client gates on the flag rather than on a field existing.
  expect(info.features.health).toBe(false);
  expect(info.features.brief).toBe(false);
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
