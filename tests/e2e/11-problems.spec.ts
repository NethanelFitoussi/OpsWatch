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

test('the overview menu links every page it names, with none left disabled', async ({ page }) => {
  await page.goto(problemsUrl());
  const nav = page.getByRole('navigation', { name: 'Overview pages' });
  // Every Overview sub-page is built now, Checkup included, so every entry is a link.
  for (const label of ['Morning brief', 'Health', 'Problems', 'Insights', 'Checkup']) {
    await expect(nav.getByRole('link', { name: label })).toBeVisible();
  }
  await expect(nav.locator('[aria-disabled="true"]')).toHaveCount(0);
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
  expect(info.features.incidents).toBe(true);
  expect(info.features.synthetics).toBe(true);
  expect(info.features.slos).toBe(true);
  // And still reports the ones it does not, so a client gates on the flag rather than on a field existing.
  expect(info.features.ai).toBe(false);
  expect(info.features.logs).toBe(false);
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

test('a filter the server will not honour is refused, not silently dropped', async ({ page }) => {
  const base = `/api/v1/problems?env=${connectionId}:${MOTO_REGION}`;
  // The exact shape that failed in the field: a parameter the route did not read, answered with a full page.
  expect((await page.request.get(`${base}&category=infrastructure`)).status()).toBe(400);
  // A declared filter with an undeclared value fails too, rather than answering a narrower question.
  expect((await page.request.get(`${base}&status=nonsense`)).status()).toBe(400);
  expect((await page.request.get(`${base}&severity=disastrous`)).status()).toBe(400);
  expect((await page.request.get(`${base}&since=yesterday`)).status()).toBe(400);
  expect((await page.request.get(`${base}&service=a&service=b`)).status()).toBe(400);
});

test('the filters a client may send are in the OpenAPI document', async ({ page }) => {
  const doc = await page.request.get('/api/v1/openapi.json').then((r) => r.json());
  const parameters = doc.paths['/api/v1/problems'].get.parameters ?? [];
  const names = parameters.filter((p: { in: string }) => p.in === 'query').map((p: { name: string }) => p.name);
  // Undiscoverable filters are how a client comes to invent its own request vocabulary.
  expect(names.sort()).toEqual(['service', 'severity', 'since', 'status']);
});

test('filters that are honoured actually narrow the list', async ({ page }) => {
  const base = `/api/v1/problems?env=${connectionId}:${MOTO_REGION}`;
  const all = await page.request.get(base).then((r) => r.json());
  const resolved = await page.request.get(`${base}&status=resolved`).then((r) => r.json());
  expect(Array.isArray(resolved.items)).toBe(true);
  // Every row that came back is the status that was asked for — the assertion the silent drop would fail.
  for (const item of resolved.items) expect(item.status).toBe('resolved');
  expect(resolved.items.length).toBeLessThanOrEqual(all.items.length);
});

test('§7 — the three evidence bands are visibly separate, and a guess is never presented as a fact', async ({ page }) => {
  await page.goto(problemsUrl());
  const first = page.locator('main a[href*="/overview/problems/"]').first();
  if ((await first.count()) === 0) test.skip(true, 'no problem detected in this environment');
  await first.click();
  await expect(page).toHaveURL(/\/overview\/problems\/[^/]+$/);

  const main = await page.locator('main').innerText();
  // Either the timeline has bands, or it says plainly that nothing else was recorded. Never a blank.
  const hasBands = main.includes('Observed facts');
  const saysNothing = main.includes('recorded nothing else around the time this started');
  expect(hasBands !== saysNothing).toBe(true);

  if (hasBands) {
    // Three headed groups, in order, so position alone tells a reader which band they are in.
    for (const band of ['Observed facts', 'Happened near each other', 'Possible explanations']) {
      await expect(page.getByRole('heading', { name: band })).toBeVisible();
    }
    expect(main.indexOf('Observed facts')).toBeLessThan(main.indexOf('Possible explanations'));
    // The sentence that keeps the middle band honest.
    expect(main).toContain('This is a measured gap, not a cause');
    // And the word the whole design forbids.
    expect(main).not.toMatch(/\bcaused by\b/i);
  } else {
    expect(main).toContain('not the same as nothing having happened');
  }
});

test('§7 — a problem with no deployment near it shows no correlation card at all', async ({ page }) => {
  await page.goto(problemsUrl());
  const first = page.locator('main a[href*="/overview/problems/"]').first();
  if ((await first.count()) === 0) test.skip(true, 'no problem detected in this environment');

  await first.click();
  await expect(page).toHaveURL(/\/overview\/problems\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Evidence' })).toBeVisible();
  const main = await page.locator('main').innerText();
  // The deployments job has recorded nothing here, so the card is absent rather than an empty list that
  // would read as "nothing was deployed".
  expect(main).not.toContain('Deployments just before this started');
});
