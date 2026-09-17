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
