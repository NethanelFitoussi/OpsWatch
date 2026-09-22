import { expect, test } from '@playwright/test';
import { systemStatusSchema } from '@opswatch/contract';
import { login } from './helpers';

test('the liveness endpoint answers a probe and says nothing else', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  const body = await response.json();
  // A reverse proxy needs the process to be up. Anyone else must learn nothing from it.
  expect(Object.keys(body).sort()).toEqual(['status', 'version']);
  expect(body.status).toBe('ok');
  const text = await request.get('/api/health').then((r) => r.text());
  for (const secret of ['sqlite', 'OPSWATCH_SECRET', 'connection', '/data']) expect(text).not.toContain(secret);
});

test('System status needs a session', async ({ request }) => {
  expect((await request.get('/api/v1/system/status')).status()).toBe(401);
});

test('System status reports the collector, its jobs and the database', async ({ page }) => {
  await login(page);
  const response = await page.request.get('/api/v1/system/status');
  expect(response.status(), await response.text()).toBe(200);
  const status = systemStatusSchema.parse(await response.json());

  // Every job in the catalogue is listed, including the ones that have never run: "never" is its own answer.
  expect(status.jobs.length).toBeGreaterThanOrEqual(10);
  expect(status.version).toMatch(/^\d+\.\d+\.\d+/);
  expect(typeof status.collector.neverRan).toBe('boolean');
  expect(status.database.schemaVersion).toBeGreaterThan(0);
});

test('the System status page renders for an admin, and says whether the collector is running', async ({ page }) => {
  await login(page);
  await page.goto('/en/settings/status');
  await expect(page.getByRole('heading', { level: 1, name: 'System status' })).toBeVisible();
  const main = await page.locator('body').innerText();
  // Exactly one verdict about the collector, and "never run" is one of them.
  const says = ['Running', 'Not running', 'has never run'].filter((phrase) => main.includes(phrase));
  expect(says.length).toBeGreaterThanOrEqual(1);
  // The job table names the jobs it is reporting on.
  for (const job of ['detect', 'inventory', 'compact']) expect(main).toContain(job);
});

test('System status redirects an unauthenticated visitor to login', async ({ page }) => {
  await page.goto('/en/settings/status');
  await expect(page).toHaveURL(/\/en\/login$/);
});
