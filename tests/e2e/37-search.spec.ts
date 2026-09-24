import { expect, test } from '@playwright/test';
import { ensureMonitoringConnection, login, monitoringUrl } from './helpers';

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

test('THE RULING: search opens from the keyboard, anywhere', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'overview', 'problems'));
  // `/` is the shortcut a text-first tool has; the dialog is what it opens.
  await page.keyboard.press('/');
  await expect(page.getByRole('dialog', { name: 'Search OpsWatch' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Search OpsWatch' })).toHaveCount(0);

  // And the other shortcut everybody's fingers already know.
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('dialog', { name: 'Search OpsWatch' })).toBeVisible();
});

test('a result says what it is and where it is, and Enter opens it', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'overview', 'problems'));
  await page.keyboard.press('/');
  await page.getByRole('combobox', { name: 'Search OpsWatch' }).fill('opswatch-e2e-high-cpu');

  const options = page.getByRole('option');
  await expect(options.first()).toBeVisible();
  // Type, environment and region: what stops two identically-named things being confused.
  await expect(options.first()).toContainText(/Problem · .* · us-east-1/);

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/overview\/problems\/[0-9a-f]+$/);
});

test('the arrows move the selection without taking focus off the input', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'overview', 'problems'));
  await page.keyboard.press('/');
  const input = page.getByRole('combobox', { name: 'Search OpsWatch' });
  await input.fill('redis');
  await expect(page.getByRole('option').first()).toBeVisible();

  await page.keyboard.press('ArrowDown');
  // A screen reader follows `aria-activedescendant`; the caret stays where the operator is typing.
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('aria-activedescendant', /.+/);
  await expect(page.getByRole('option', { selected: true })).toHaveCount(1);
});

test('THE RULING: it finds documentation by words the guide does not use', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'overview', 'problems'));
  await page.keyboard.press('/');
  await page.getByRole('combobox', { name: 'Search OpsWatch' }).fill('save metrics');
  await expect(page.getByRole('option').filter({ hasText: 'Documentation' }).first()).toBeVisible();
});

test('THE RULING: live infrastructure is offered as a jump, not claimed as an index', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'overview', 'problems'));
  await page.keyboard.press('/');
  await page.getByRole('combobox', { name: 'Search OpsWatch' }).fill('web');

  // OpsWatch holds no inventory of live ECS services, so it offers to carry the query into the section
  // that can ask AWS — rather than pretending it already knows.
  const jump = page.getByRole('option').filter({ hasText: 'Search ECS services' });
  await expect(jump).toHaveCount(1);
  await jump.click();
  await expect(page).toHaveURL(/\/containers\/services\?.*q=web/);
});

test('GET /api/v1/search answers the shape every client parses, and is scoped', async ({ page }) => {
  const ok = await page.request.get(`/api/v1/search?env=${connectionId}:us-east-1&q=opswatch`);
  expect(ok.status()).toBe(200);
  const body = (await ok.json()) as { query: string; items: { kind: string; title: string; context: string; href: string }[]; truncated: boolean };
  expect(body.query).toBe('opswatch');
  expect(Array.isArray(body.items)).toBe(true);
  for (const item of body.items) {
    expect(item.href.startsWith('/'), item.href).toBe(true);
    expect(item.context.length).toBeGreaterThan(0);
  }
  // An environment this instance does not have is not found, never an empty list.
  expect((await page.request.get('/api/v1/search?env=000000000000:us-east-1&q=x')).status()).toBe(404);
});

test('search refuses an anonymous caller', async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL });
  expect((await anonymous.get('/api/v1/search?env=x:y&q=z')).status()).toBe(401);
  await anonymous.dispose();
});
