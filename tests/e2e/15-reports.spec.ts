import { expect, test } from '@playwright/test';
import { reportSchema } from '@opswatch/contract';
import { MOTO_REGION, ensureMonitoringConnection, login, monitoringUrl } from './helpers';

/**
 * Reports (§19).
 *
 * The acceptance criterion is the one the owner set: these four pages said "Coming soon" and now must be
 * real. Real here means reachable by clicking, honest about the halves it cannot answer, and comparing the
 * period against the one before it.
 */

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

const SECTIONS = ['containers', 'databases', 'load-balancers', 'alarms', 'overview', 'logs'] as const;

test('the section menu links to Report instead of disabling it', async ({ page }) => {
  for (const section of SECTIONS) {
    await page.goto(monitoringUrl(connectionId, section));
    const link = page.locator(`main a[href*="/${section}/report"], nav a[href*="/${section}/report"]`).first();
    await expect(link, `${section} should link to its report`).toBeVisible();
  }
  // And nothing anywhere still calls them coming soon.
  await page.goto(monitoringUrl(connectionId, 'containers'));
  expect(await page.locator('body').innerText()).not.toContain('Coming soon');
});

test('a report opens by clicking, and states the period it covers', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'containers'));
  await page.locator('a[href*="/containers/report"]').first().click();
  await expect(page).toHaveURL(/\/containers\/report(\?|$)/);

  const main = await page.locator('main').innerText();
  expect(main).toContain('Report');
  expect(main).toContain('Compared with');
  // §19: it reads what is stored, so it must say it costs nothing.
  expect(main).toContain('makes no new AWS request');
});

test('§2.6 — a half it cannot answer says which and why, and never shows zero instead', async ({ page }) => {
  await page.goto(`${monitoringUrl(connectionId, 'containers', 'report')}`);
  const main = await page.locator('main').innerText();

  // Historical collection is off on a fresh instance, so availability must say exactly that.
  expect(main).toContain('Historical collection is off');
  expect(main).toContain('This is a setting, not a fault');
  // And it offers the page where that decision is made.
  await expect(page.getByRole('link', { name: 'Open Data & history' })).toBeVisible();

  // Deployments and synthetics say nothing is configured to collect them, which is a sharper answer than
  // "not measured": on a fresh instance nobody has added a check or shipped anything OpsWatch watched.
  expect(main).toContain('Nothing is configured to collect this');
  expect(main).toContain('This is not the same as there being none');
});

test('the period can be changed, and the report follows', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'databases', 'report'));
  await page.getByRole('link', { name: 'Last 24 hours' }).click();
  await expect(page).toHaveURL(/period=24h/);
  // The chosen period is marked as the current one for a screen reader, not only by colour.
  await expect(page.getByRole('link', { name: 'Last 24 hours' })).toHaveAttribute('aria-current', 'page');
});

test('an unknown period falls back rather than answering 404', async ({ page }) => {
  const response = await page.goto(`${monitoringUrl(connectionId, 'alarms', 'report')}?period=nonsense`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('link', { name: 'Last 7 days' })).toHaveAttribute('aria-current', 'page');
});

test('GET /api/v1/reports answers the shape every client parses', async ({ page }) => {
  const url = `/api/v1/reports?env=${connectionId}:${MOTO_REGION}&section=containers&period=7d`;
  const response = await page.request.get(url);
  expect(response.status(), await response.text()).toBe(200);
  const report = reportSchema.parse(await response.json());

  expect(report.section).toBe('containers');
  expect(report.period.id).toBe('7d');
  // The previous window meets this one exactly.
  expect(report.previousPeriod.to).toBe(report.period.from);
  // Availability is off, and says so as a named reason rather than as an empty section.
  expect(report.sections.find((section) => section.id === 'availability')?.unavailable).toBe('history_off');
});

test('the reports endpoint validates both of its parameters', async ({ page }) => {
  const base = `/api/v1/reports?env=${connectionId}:${MOTO_REGION}`;
  expect((await page.request.get(`${base}&section=nope&period=7d`)).status()).toBe(400);
  expect((await page.request.get(`${base}&section=containers&period=nope`)).status()).toBe(400);
});

test('reports need a session', async ({ request }) => {
  expect((await request.get('/api/v1/reports?section=containers')).status()).toBe(401);
});

test('a report renders at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(monitoringUrl(connectionId, 'containers', 'report'));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('§19 — the report exports as Markdown, and downloads rather than renders', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'containers', 'report'));
  const link = page.getByRole('link', { name: 'Export as Markdown' });
  await expect(link).toBeVisible();

  const href = await link.getAttribute('href');
  const response = await page.request.get(href ?? '');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/markdown');
  // An attachment, and never sniffed into something executable: a report quotes log lines.
  expect(response.headers()['content-disposition']).toContain('attachment');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');

  const markdown = await response.text();
  // The same answer the page gave, in the same words.
  expect(markdown).toContain('# Report');
  expect(markdown).toContain('## Availability');
  expect(markdown).toContain('Historical collection is off');
});

/**
 * REP-6 — the two reports that are not about one infrastructure family.
 *
 * Overview summarises the whole estate; Logs reports on what was read out of logs and what reading them
 * cost. Both are the same object as a section report, so everything above applies to them too — what is
 * tested here is what only they do.
 */
test('THE RULING: the estate report counts every problem, and refuses to average availability', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'overview', 'report'));
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Problems' })).toBeVisible();

  // A family breakdown, in the words the rest of the product uses — not detector ids.
  await expect(main.getByRole('heading', { name: 'By family' })).toBeVisible();
  for (const family of ['Containers', 'Databases', 'Load balancers', 'Alarms']) {
    await expect(main.getByRole('rowheader', { name: family })).toBeVisible();
  }

  // Availability is measured per family, so there is no estate number and the page says so rather than
  // averaging four families into one figure nobody could act on.
  await expect(main).toContainText('does not measure this yet');
});

test('the logs report says what searching cost and what that cost stopped', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'logs', 'report'));
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'What searching logs cost' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Log groups being read' })).toBeVisible();

  // The figure is instance-wide, and the page says which figure it is rather than implying a split the
  // data does not hold.
  const text = await main.innerText();
  if (text.includes('GB scanned')) {
    expect(text).toContain('Across this whole OpsWatch installation');
  } else {
    // Nothing recorded is `not_collected` — never a spend of zero gigabytes over a week nobody looked at.
    expect(text).toContain('Nothing is configured to collect this');
  }
});

test('both new reports export as Markdown through the same endpoint', async ({ page }) => {
  for (const section of ['overview', 'logs'] as const) {
    const response = await page.request.get(`/api/v1/reports?env=${connectionId}:${MOTO_REGION}&section=${section}&period=7d`);
    expect(response.status(), section).toBe(200);
    const report = reportSchema.parse(await response.json());
    expect(report.section, section).toBe(section);
    expect(report.sections.length, section).toBeGreaterThan(0);

    const markdown = await page.request.get(`/api/v1/reports?env=${connectionId}:${MOTO_REGION}&section=${section}&period=7d&format=markdown`);
    expect(markdown.headers()['content-type'], section).toContain('text/markdown');
    expect(markdown.headers()['content-disposition'], section).toContain('attachment');
  }
});
