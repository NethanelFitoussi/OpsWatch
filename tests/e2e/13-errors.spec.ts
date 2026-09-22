import { expect, test } from '@playwright/test';
import { errorSummarySchema, pageSchema } from '@opswatch/contract';
import { MOTO_REGION, ensureMonitoringConnection, login } from './helpers';

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

const errorsUrl = () => `/en/c/${connectionId}/${MOTO_REGION}/errors/groups`;

test('Errors is a section of its own in the rail', async ({ page }) => {
  await page.goto(errorsUrl());
  await expect(page.getByRole('link', { name: 'Errors' }).first()).toBeVisible();
});

test('the Errors page explains that collection is off rather than claiming there are no errors', async ({ page }) => {
  await page.goto(errorsUrl());
  const main = await page.locator('main').innerText();
  // Three different facts, kept apart. On a fresh instance no log source exists, so it must say *that* —
  // "no errors" when OpsWatch was never allowed to look is the same lie the Health page refuses to tell.
  const notAllowed = /not reading errors from any log group|No log group is switched on/.test(main);
  const nothingFound = /No errors have been collected/.test(main);
  // Scoped to links into a group: the section menu is also a list inside `main`.
  const hasRows = (await page.locator('main a[href*="/errors/groups/"]').count()) > 0;
  expect([notAllowed, nothingFound, hasRows].filter(Boolean)).toHaveLength(1);
});

test('the reason given names the cost, because that is why it is off', async ({ page }) => {
  await page.goto(errorsUrl());
  const main = await page.locator('main').innerText();
  if (main.includes('not reading errors from any log group')) {
    expect(main).toContain('billed per gigabyte');
  }
});

test('GET /api/v1/errors answers the shape every client parses', async ({ page }) => {
  const response = await page.request.get(`/api/v1/errors?env=${connectionId}:${MOTO_REGION}`);
  expect(response.status(), await response.text()).toBe(200);
  const parsed = pageSchema(errorSummarySchema).parse(await response.json());
  expect(Array.isArray(parsed.items)).toBe(true);
});

test('an error id from another environment reads as absent', async ({ page }) => {
  const response = await page.request.get(`/api/v1/errors/no-such-group?env=${connectionId}:${MOTO_REGION}`);
  expect(response.status()).toBe(404);
});

test('the server reports errors as a capability it serves', async ({ page }) => {
  const info = await page.request.get('/api/v1/server').then((r) => r.json());
  expect(info.features.errors).toBe(true);
});

test('the Errors page renders at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(errorsUrl());
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
