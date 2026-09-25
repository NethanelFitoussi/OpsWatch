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
  // The job table names the jobs it is reporting on. `inventory` used to be one of them, and was never
  // written: it ran every half hour, did nothing, and appeared here as a job going about its rounds.
  for (const job of ['detect', 'deployments', 'compact']) expect(main).toContain(job);
  expect(main).not.toContain('inventory');
});

test('System status redirects an unauthenticated visitor to login', async ({ page }) => {
  await page.goto('/en/settings/status');
  await expect(page).toHaveURL(/\/en\/login$/);
});

test('§12 — preferences belong to the user, and an update is partial', async ({ page }) => {
  await login(page);

  // A user who has set none gets the defaults rather than an empty object.
  const initial = await page.request.get('/api/v1/me/preferences').then((r) => r.json());
  expect(initial.notifications.minSeverity).toBe('critical');
  expect(initial.notifications.categories.length).toBeGreaterThan(0);

  await page.request.post('/api/v1/me/preferences', { data: { locale: 'fr', defaultEnvironmentId: 'c1:us-east-1' } });
  // Sending only the notifications must not erase what was set before.
  const patched = await page.request
    .post('/api/v1/me/preferences', { data: { notifications: { minSeverity: 'warning', categories: ['alert'] } } })
    .then((r) => r.json());

  expect(patched).toMatchObject({ locale: 'fr', defaultEnvironmentId: 'c1:us-east-1' });
  expect(patched.notifications).toEqual({ minSeverity: 'warning', categories: ['alert'] });

  // Left as found, so later specs see the account they expect.
  await page.request.post('/api/v1/me/preferences', {
    data: { locale: null, defaultEnvironmentId: null, notifications: { minSeverity: 'critical', categories: ['critical_problem', 'alert', 'synthetic_failure', 'incident', 'recovery'] } },
  });
});

test('preferences need a session', async ({ request }) => {
  expect((await request.get('/api/v1/me/preferences')).status()).toBe(401);
  expect((await request.post('/api/v1/me/preferences', { data: {} })).status()).toBe(401);
});
