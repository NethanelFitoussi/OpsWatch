import { expect, test, type Page } from '@playwright/test';
import { MOTO_REGION, createConnection, ensureMonitoringConnection, login, monitoringUrl } from './helpers';

/**
 * Two AWS accounts in one OpsWatch.
 *
 * The product is meant to hold Production, Staging, Client A and Client B at once, and the failure mode
 * is never a missing feature — it is a WHERE clause that forgot which account it was answering for. So
 * these tests do not check that two connections *exist*; they check that one cannot reach the other.
 *
 * The second connection is created here and removed again at the end, so the specs that follow find the
 * estate they expect.
 */

let first = '';
let second = '';
const SECOND = 'Client B monitoring';

test.beforeEach(async ({ page }) => {
  await login(page);
  first = await ensureMonitoringConnection(page);

  await page.goto('/en/accounts');
  const existing = page.getByRole('link', { name: new RegExp(SECOND) });
  if ((await existing.count()) > 0) {
    second = ((await existing.first().getAttribute('href')) ?? '').split('/').pop() as string;
    return;
  }
  second = await createConnection(page, 'ambient', SECOND);
  // Until its permission test has passed the connection is not monitorable, and every monitoring URL
  // for it redirects to its account page — which is correct, and not what these tests are about.
  await page.getByRole('button', { name: 'Run test' }).click();
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 });
});

test.afterAll(async ({ browser }) => {
  // Left behind, the extra connection would change which one a section link without an environment
  // resolves to for every later spec.
  test.setTimeout(120_000);
  const page = await browser.newPage();
  await login(page);
  await page.goto('/en/accounts');
  const link = page.getByRole('link', { name: new RegExp(SECOND) });
  if ((await link.count()) > 0) {
    await link.first().click();
    await page.getByRole('button', { name: 'Remove connection' }).click();
    await expect(page.getByRole('link', { name: new RegExp(SECOND) })).toHaveCount(0, { timeout: 30_000 });
  }
  await page.close();
});

test('two AWS connections coexist, each with its own identity', async ({ page }) => {
  await page.goto('/en/accounts');
  await expect(page.getByRole('link', { name: /Moto monitoring/ })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(SECOND) })).toBeVisible();
  expect(first).not.toBe(second);

  // Each has its own page, and each names itself rather than "the connection".
  await page.goto(`/en/accounts/${second}`);
  await expect(page.locator('main')).toContainText(SECOND);
  await expect(page.locator('main')).not.toContainText('Moto monitoring');
});

/** Adds a synthetic check to one environment and returns its name. */
async function addCheck(page: Page, connectionId: string, name: string) {
  await page.goto(monitoringUrl(connectionId, 'overview', 'synthetics'));
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('URL').fill('https://example.com/healthz');
  await page.getByRole('button', { name: 'Save check' }).click();
  await expect(page.locator('main')).toContainText(name);
}

test('THE RULING: a check belongs to one connection, and the other never sees it', async ({ page }) => {
  await addCheck(page, first, 'Checkout health A');

  // The second connection's page is its own environment, not a view onto the estate.
  await page.goto(monitoringUrl(second, 'overview', 'synthetics'));
  await expect(page.locator('main')).not.toContainText('Checkout health A');
  await expect(page.locator('main')).toContainText('No check has been added.');

  // The id travels in a form field, so the rule that matters is at the store: `deleteCheck` takes the
  // environment and will not delete outside it, proved by breaking it in
  // `tests/unit/synthetics-store.test.ts`. What a browser can show is that the check is untouched.
  await page.goto(monitoringUrl(first, 'overview', 'synthetics'));
  await expect(page.locator('main')).toContainText('Checkout health A');

  // Removing it from its own page does work, which makes the isolation a scoping rule rather than a
  // broken button.
  await page.getByRole('button', { name: 'Remove' }).first().click();
  await expect(page.locator('main')).not.toContainText('Checkout health A');
});

test('THE RULING: the v1 API answers for one environment, and an id from the other is absent', async ({ page }) => {
  const envOne = `${first}:${MOTO_REGION}`;
  const envTwo = `${second}:${MOTO_REGION}`;

  const problems = await page.request.get(`/api/v1/problems?env=${envOne}`).then((r) => r.json());
  const problem = (problems.items as { id: string }[])[0];
  test.skip(problem === undefined, 'no problem has been detected in the first environment yet');

  // Present where it belongs.
  expect((await page.request.get(`/api/v1/problems/${problem.id}?env=${envOne}`)).status()).toBe(200);
  // Absent — not forbidden — where it does not. A client that cannot tell the two apart will show
  // "nothing is wrong there" when it means "that is not one of mine".
  expect((await page.request.get(`/api/v1/problems/${problem.id}?env=${envTwo}`)).status()).toBe(404);
  expect((await page.request.get(`/api/v1/investigations/${problem.id}?env=${envTwo}`)).status()).toBe(404);

  // And the second environment's own lists are its own, not a copy of the first's.
  const theirs = await page.request.get(`/api/v1/problems?env=${envTwo}`).then((r) => r.json());
  expect((theirs.items as { id: string }[]).some((one) => one.id === problem.id)).toBe(false);
});

test('a log search started in one connection cannot be polled from the other', async ({ page, baseURL }) => {
  const started = await page.request.post(`/api/v1/logs/searches?env=${first}:${MOTO_REGION}`, {
    data: { logGroups: ['/ecs/opswatch-web'], rangeSeconds: 600, limit: 10 },
    headers: { origin: baseURL as string },
  });
  expect(started.status()).toBe(202);
  const { searchId } = (await started.json()) as { searchId: string };

  // The binding names the connection as well as the person, so the same id under another environment is
  // not a search this caller has — and says so as absence rather than as a refusal.
  expect((await page.request.get(`/api/v1/logs/searches/${searchId}?env=${second}:${MOTO_REGION}`)).status()).toBe(404);
  expect((await page.request.get(`/api/v1/logs/searches/${searchId}?env=${first}:${MOTO_REGION}`)).status()).toBe(200);
});

test('THE RULING: a section link opens the connection the operator chose, not the first one', async ({ page }) => {
  /*
   * A link clicked from a page with no environment in its URL — Settings, the documentation, Cloudflare
   * — used to go to whichever connection happened to be first. With two AWS accounts that meant an
   * operator working in one client's account could land in another's, with nothing on screen saying so.
   */
  await page.goto('/en/settings');
  await page.getByLabel('Open in').selectOption(`${second}:${MOTO_REGION}`);
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.goto('/en/containers');
  await expect(page).toHaveURL(new RegExp(`/c/${second}/${MOTO_REGION}/containers/`));

  // Cleared again, it falls back to the first monitorable connection rather than to a dead end.
  await page.goto('/en/settings');
  await page.getByLabel('Open in').selectOption('');
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.goto('/en/containers');
  await expect(page).toHaveURL(/\/c\/[0-9a-f]{12}\/[a-z0-9-]+\/containers\//);
});

test('the switcher names the account the page is about, and no account when there is none', async ({ page }) => {
  const chip = page.getByRole('button', { name: 'Connection' });

  await page.goto(monitoringUrl(second, 'overview', 'health'));
  await expect(chip).toContainText(SECOND);
  await expect(chip).toContainText(MOTO_REGION);

  // Settings belongs to the whole installation. Claiming an account here was how the top bar came to
  // read "Production" above a page that had nothing to do with it.
  await page.goto('/en/settings');
  await expect(chip).toContainText('Choose a connection');
  await expect(chip).not.toContainText(SECOND);

  // And each region is a destination rather than a caption: the regions used to be printed as inert
  // text while every entry navigated to `regions[0]`.
  await page.goto(monitoringUrl(first, 'overview', 'health'));
  await chip.click();
  await page.getByRole('menuitem', { name: MOTO_REGION }).last().click();
  await expect(page).toHaveURL(/\/c\/[0-9a-f]{12}\/us-east-1\/overview\/health/);
});

test('THE RULING: a webhook can belong to one client, and says which', async ({ page }) => {
  /*
   * An alert rule belongs to an environment and a destination belonged to the installation, so the
   * engine was scoped and the delivery was not: every enabled endpoint received every environment's
   * alerts. With two clients in one OpsWatch that is one client's problems arriving at another's
   * endpoint — not a preference.
   */
  await page.goto('/en/settings/notifications');
  await page.getByLabel('Name').fill('Client B pager');
  await page.getByLabel('URL').fill('https://example.com/client-b');
  // The question is only asked once there is more than one account, which is the case here.
  await page.getByLabel('Which connection’s alerts').selectOption(second);
  await page.getByRole('button', { name: 'Add destination' }).click();

  // The secret is shown once, and the list says what this endpoint will receive.
  await expect(page.getByText('Your signing secret')).toBeVisible();
  await expect(page.locator('main')).toContainText(`Receives alerts from ${SECOND} only`);

  // An unscoped one still receives everything, which is what a single-account installation means.
  await page.getByLabel('Name').fill('Everything');
  await page.getByLabel('URL').fill('https://example.com/all');
  await page.getByRole('button', { name: 'Add destination' }).click();
  await expect(page.locator('main')).toContainText('Receives alerts from every connection');

  // Tidy up: a destination left behind would receive every later spec's alerts.
  for (const name of ['Client B pager', 'Everything']) {
    const row = page.getByRole('listitem').filter({ hasText: name });
    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('main')).not.toContainText(name);
  }
});
