import { expect, test } from '@playwright/test';
import { MOTO_REGION, ensureMonitoringConnection, login } from './helpers';

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

test('the logs page searches groups, runs a query and shows rows', async ({ page }) => {
  await login(page);
  const id = await ensureMonitoringConnection(page);
  await page.goto(`/en/c/${id}/${MOTO_REGION}/logs`);
  await expect(page).toHaveTitle('Logs · OpsWatch');
  await page.getByLabel('Log group name prefix').fill('/ecs');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('checkbox', { name: /\/ecs\/opswatch-web/ }).check();
  await page.getByRole('button', { name: 'Use selected groups' }).click();
  await expect(page).toHaveURL(/group=%2Fecs%2Fopswatch-web/);
  await expect(page.getByLabel('Query', { exact: true })).toHaveValue('fields @timestamp, @message | sort @timestamp desc | limit 100');
  await page.getByRole('button', { name: 'Run query' }).click();
  const results = page.getByRole('table', { name: 'Query results' });
  // moto returns every event in range at once (fact 10).
  await expect(results.getByRole('row').filter({ hasText: 'ERROR payment gateway timeout' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/^3 rows · /)).toBeVisible();
});

test('the service page links to its log group', async ({ page }) => {
  await login(page);
  const id = await ensureMonitoringConnection(page);
  await page.goto(`/en/c/${id}/${MOTO_REGION}/containers/opswatch-e2e/web`);
  await page.getByRole('link', { name: '/ecs/opswatch-web' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${id}/${MOTO_REGION}/logs\\?group=%2Fecs%2Fopswatch-web$`));
  await expect(page.getByText('/ecs/opswatch-web').first()).toBeVisible();
});
