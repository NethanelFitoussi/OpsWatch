import { expect, test, type Page } from '@playwright/test';
import { MOTO_REGION, ensureMonitoringConnection, login } from './helpers';

/**
 * The log groups are chosen in a popover rather than in a permanent column, so a test that wants one
 * opens the picker, ticks it and closes again — which is also what a person does.
 */
const openSources = (page: Page) => page.getByRole('button', { name: 'Sources' }).click();

async function pickSource(page: Page, name: RegExp) {
  await openSources(page);
  await page.getByRole('checkbox', { name }).check();
  await page.getByRole('button', { name: 'Done' }).click();
}

test('the Logs Insights routes check origin, session and query ownership', async ({ page, playwright, baseURL }) => {
  await login(page);
  const id = await ensureMonitoringConnection(page);
  const path = `/api/connections/${id}/regions/${MOTO_REGION}/logs/query`;
  const now = Math.floor(Date.now() / 1000);
  const data = { logGroups: ['/ecs/opswatch-web'], query: 'fields @timestamp, @message | limit 5', startSeconds: now - 3600, endSeconds: now };

  const anonymous = await playwright.request.newContext({ baseURL });
  expect((await anonymous.post(path, { data, headers: { origin: 'https://evil.example' } })).status()).toBe(403);
  expect((await anonymous.post(path, { data, headers: { origin: baseURL as string } })).status()).toBe(401);
  await anonymous.dispose();

  expect((await page.request.get(`${path}/not-a-query-id`)).status()).toBe(404);
  const started = await page.request.post(path, { data, headers: { origin: baseURL as string } });
  expect(started.status()).toBe(200);
  const { queryId } = (await started.json()) as { queryId: string };
  const results = await page.request.get(`${path}/${queryId}`);
  expect(results.status()).toBe(200);
  expect(((await results.json()) as { status: string }).status).toBe('Complete');
  expect((await page.request.post(`/api/connections/${id}/regions/eu-west-3/logs/query`, { data, headers: { origin: baseURL as string } })).status()).toBe(404);
});

test('THE RULING: the page opens on a search box, not on a column of log-group checkboxes', async ({ page }) => {
  await login(page);
  const id = await ensureMonitoringConnection(page);
  await page.goto(`/en/c/${id}/${MOTO_REGION}/logs`);
  await expect(page).toHaveTitle('Logs · OpsWatch');

  // The first control is the search box, and the sources are one control beside it rather than a column.
  await expect(page.getByLabel('Find in logs')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sources' })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  // The raw query language is advanced, and closed until it is asked for.
  await expect(page.getByLabel('Query', { exact: true })).toHaveCount(0);

  // And the empty page offers the questions people actually arrive with rather than a void.
  await expect(page.getByRole('button', { name: 'Errors only' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'HTTP 500s' })).toBeVisible();

  const run = page.getByRole('button', { name: 'Search logs' });
  await expect(run).toBeDisabled();
  await expect(page.getByText('Select at least one log group to run a query.')).toBeVisible();
});

test('the source picker filters the loaded groups as you type and applies a tick at once', async ({ page }) => {
  await login(page);
  const id = await ensureMonitoringConnection(page);
  await page.goto(`/en/c/${id}/${MOTO_REGION}/logs`);
  const run = page.getByRole('button', { name: 'Search logs' });

  // Typing filters the groups already loaded, in the browser: nothing is requested and the URL does not change.
  const requests: string[] = [];
  const record = (request: { url(): string }) => requests.push(request.url());
  page.on('request', record);
  await openSources(page);
  const field = page.getByLabel('Filter log groups');
  await field.fill('lambda');
  await expect(page.getByRole('checkbox', { name: /\/aws\/lambda\/opswatch-e2e-worker/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /\/ecs\/opswatch-web/ })).toHaveCount(0);
  await field.fill('');
  await expect(page.getByRole('checkbox', { name: /\/ecs\/opswatch-web/ })).toBeVisible();
  // Next.js prefetches the sidebar sections on its own; what must not happen is a request carrying the
  // typed text or the selection, which is the only way the server could have done the filtering.
  expect(requests.filter((url) => url.includes('prefix=') || url.includes('group='))).toEqual([]);
  await expect(page).toHaveURL(`/en/c/${id}/${MOTO_REGION}/logs/search`);
  page.off('request', record);

  // Ticking applies immediately: the picker counts it, Search is enabled and the URL stays shareable.
  await page.getByRole('checkbox', { name: /\/ecs\/opswatch-web/ }).check();
  await expect(page.getByText('1 of 2 chosen')).toBeVisible();
  await expect(page).toHaveURL(/group=%2Fecs%2Fopswatch-web/);
  await page.getByRole('button', { name: 'Done' }).click();
  // One group is named on the trigger rather than counted, so the selection is legible without opening it.
  await expect(page.getByRole('button', { name: 'Sources' })).toContainText('/ecs/opswatch-web');
  await expect(run).toBeEnabled();

  // And it can be undone in one action rather than in one click per group.
  await openSources(page);
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByText('0 of 2 chosen')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(run).toBeDisabled();
});

test('THE RULING: a quick search runs a real search in one press', async ({ page }) => {
  await login(page);
  const id = await ensureMonitoringConnection(page);
  await page.goto(`/en/c/${id}/${MOTO_REGION}/logs/search`);
  await pickSource(page, /\/ecs\/opswatch-web/);

  await page.getByRole('button', { name: 'Errors only' }).click();
  await expect(page.getByRole('list', { name: 'Log lines' })).toBeVisible({ timeout: 15_000 });
  // It set the controls it used, so the search can be adjusted rather than only repeated.
  await expect(page.getByLabel('Level')).toHaveValue('error');
});

test('THE RULING: a search is a search box, and the query it builds is shown rather than hidden', async ({ page }) => {
  await login(page);
  const id = await ensureMonitoringConnection(page);
  await page.goto(`/en/c/${id}/${MOTO_REGION}/logs/search`);
  await pickSource(page, /\/ecs\/opswatch-web/);

  // Nobody has to know the query language to find a line.
  await page.getByLabel('Find in logs').fill('timeout');
  await page.getByRole('button', { name: 'Search logs' }).click();
  const rows = page.getByRole('list', { name: 'Log lines' });
  await expect(rows.getByText('ERROR payment gateway timeout')).toBeVisible({ timeout: 15_000 });

  // The query that really ran is on the page, exactly as it was sent.
  await page.getByText('The query OpsWatch will run').click();
  await expect(page.getByLabel('Query', { exact: true })).toHaveValue(
    'fields @timestamp, @logStream, @message | filter @message like /(?i)timeout/ | sort @timestamp desc | limit 100',
  );
});

test('THE RULING: nothing found and nothing searched are different sentences', async ({ page }) => {
  await login(page);
  const id = await ensureMonitoringConnection(page);
  await page.goto(`/en/c/${id}/${MOTO_REGION}/logs/search`);
  // Nothing selected yet.
  await expect(page.getByText('No log group is selected, so there is nothing to search.')).toBeVisible();

  await pickSource(page, /\/ecs\/opswatch-web/);
  await expect(page.getByText('Nothing has been searched yet.')).toBeVisible();

  // A search that ran and matched nothing says so, and says it is not the same as nothing being logged.
  // moto ignores a `filter` clause and answers with every event it holds, so the empty answer has to come
  // from a log group with no events in it rather than from a term that matches none.
  await openSources(page);
  await page.getByRole('checkbox', { name: /\/ecs\/opswatch-web/ }).uncheck();
  await page.getByRole('checkbox', { name: /\/aws\/lambda\/opswatch-e2e-worker/ }).check();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Search logs' }).click();
  await expect(page.getByText('The search ran and nothing matched.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('That is not the same as nothing having been logged.')).toBeVisible();
});

test('a log line expands to every field of the record, and the level it announces is shown', async ({ page }) => {
  await login(page);
  const id = await ensureMonitoringConnection(page);
  await page.goto(`/en/c/${id}/${MOTO_REGION}/logs/search`);
  await pickSource(page, /\/ecs\/opswatch-web/);
  await page.getByRole('button', { name: 'Search logs' }).click();
  const row = page.getByRole('list', { name: 'Log lines' }).getByRole('button').filter({ hasText: 'payment gateway timeout' });
  await expect(row).toBeVisible({ timeout: 15_000 });
  // The line says ERROR, so the row says so too — and a line that says nothing gets no level at all.
  await expect(row).toContainText('error');

  await row.click();
  await expect(page.getByText('@logStream', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy this message' })).toBeVisible();
});

test('the logs page runs a query and shows rows', async ({ page }) => {
  await login(page);
  const id = await ensureMonitoringConnection(page);
  await page.goto(`/en/c/${id}/${MOTO_REGION}/logs/search`);
  await pickSource(page, /\/ecs\/opswatch-web/);
  await page.getByRole('button', { name: 'Search logs' }).click();
  const results = page.getByRole('list', { name: 'Log lines' });
  // moto returns every event in range at once (fact 10).
  await expect(results.getByRole('listitem').filter({ hasText: 'ERROR payment gateway timeout' })).toBeVisible({ timeout: 15_000 });
  // Twice on the page on purpose: once for the eye, once in the live region for a screen reader.
  await expect(page.getByText(/records scanned/).last()).toBeVisible();
  // Every matching line came back, so the count is a count rather than a sample.
  await expect(page.getByText('3 lines matched.')).toBeVisible();

  // The range lives in the URL beside the selection, so a result is a link somebody else can open.
  await page.getByLabel('Time range').selectOption('3h');
  await expect(page).toHaveURL(/range=3h/);
  await expect(page).toHaveURL(/group=%2Fecs%2Fopswatch-web/);
  await expect(page.getByLabel('Time range')).toHaveValue('3h');
});

test('the service page links to its log group', async ({ page }) => {
  await login(page);
  const id = await ensureMonitoringConnection(page);
  await page.goto(`/en/c/${id}/${MOTO_REGION}/containers/services/opswatch-e2e/web`);
  await page.getByRole('link', { name: '/ecs/opswatch-web' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${id}/${MOTO_REGION}/logs/search\\?group=%2Fecs%2Fopswatch-web$`));
  await expect(page.getByText('/ecs/opswatch-web').first()).toBeVisible();
});

test('the picker keeps the selection across an AWS search', async ({ page }) => {
  await login(page);
  const id = await ensureMonitoringConnection(page);
  await page.goto(`/en/c/${id}/${MOTO_REGION}/logs/search`);
  await openSources(page);
  await page.getByRole('checkbox', { name: /\/ecs\/opswatch-web/ }).check();
  await expect(page).toHaveURL(/group=%2Fecs%2Fopswatch-web/);

  // Nothing loaded matches, so the server search is offered; it keeps the selection and the range in the URL.
  await page.getByLabel('Filter log groups').fill('zzz');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: /Search AWS for/ }).click();
  await expect(page).toHaveURL(/prefix=zzz/);
  await expect(page).toHaveURL(/group=%2Fecs%2Fopswatch-web/);
  await openSources(page);
  // moto ignores logGroupNamePattern and answers with every log group, so here it is the browser filter that
  // empties the list, and the message says exactly that. Against AWS the answer itself would hold no group.
  await expect(page.getByText('No loaded log group contains this text.')).toBeVisible();
  await expect(page.getByText('1 of 2 chosen')).toBeVisible();

  // Clearing the field shows that answer's groups again, with the group chosen before the search still ticked.
  await page.getByLabel('Filter log groups').fill('');
  await expect(page.getByRole('checkbox', { name: /\/ecs\/opswatch-web/ })).toBeChecked();
  await page.getByRole('checkbox', { name: /\/aws\/lambda\/opswatch-e2e-worker/ }).check();
  await page.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByRole('button', { name: 'Search logs' })).toBeEnabled();
  expect(new URL(page.url()).searchParams.getAll('group').sort()).toEqual(['/aws/lambda/opswatch-e2e-worker', '/ecs/opswatch-web']);
});

test('the picker and the search fit a 360 px viewport', async ({ page }) => {
  await login(page);
  const id = await ensureMonitoringConnection(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(`/en/c/${id}/${MOTO_REGION}/logs/search`);
  const root = page.locator('html');
  const fits = async () => expect(await root.evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(await root.evaluate((el) => el.clientWidth));

  // THE RULING: at 360px the search box and the results are what the viewport holds, and the filters do
  // not push them below the fold. The search row is the first thing under the heading.
  await expect(page.getByLabel('Find in logs')).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Search logs' })).toBeInViewport();
  await fits();

  await openSources(page);
  await page.getByRole('checkbox', { name: /\/ecs\/opswatch-web/ }).check();
  // The widest things the picker can show: a chosen group name and the search action carrying the typed text.
  await page.getByLabel('Filter log groups').fill('/aws/lambda/a-very-long-log-group-name-that-nobody-has');
  await expect(page.getByRole('button', { name: /Search AWS for/ })).toBeVisible();
  await fits();
  await page.getByRole('button', { name: 'Done' }).click();

  // And once a search has run, a log line is on screen without scrolling past a wall of controls.
  await page.getByRole('button', { name: 'Search logs' }).click();
  await expect(page.getByRole('list', { name: 'Log lines' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('list', { name: 'Log lines' }).getByRole('listitem').first()).toBeInViewport();
  await fits();
});
