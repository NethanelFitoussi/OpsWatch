import { expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * Settings → Data & history (§31.1, §33.12).
 *
 * The acceptance criterion here is what an operator sees before they spend money: that collection is off,
 * what that costs them in features, and what turning it on would cost in AWS requests — as separate lines.
 */

test('Data & history needs a session', async ({ page }) => {
  await page.goto('/en/settings/history');
  await expect(page).toHaveURL(/\/en\/login$/);
});

test('Settings links to it, because a page nothing links to is not reachable', async ({ page }) => {
  await login(page);
  await page.goto('/en/settings');
  // Reached the way a user reaches it: by clicking, not by knowing the URL.
  await page.getByRole('link', { name: 'Data & history' }).click();
  await expect(page).toHaveURL(/\/en\/settings\/history$/);

  await page.goto('/en/settings');
  await page.getByRole('link', { name: 'System status' }).click();
  await expect(page).toHaveURL(/\/en\/settings\/status$/);
});

test('a fresh installation says history is off, and what that limits', async ({ page }) => {
  await login(page);
  await page.goto('/en/settings/history');
  await expect(page.getByRole('heading', { level: 1, name: 'Data & history' })).toBeVisible();

  const body = await page.locator('body').innerText();
  expect(body).toContain('Not collecting history');
  expect(body).toContain('What stays limited without history');
  // The trade is named item by item, so it can be weighed rather than guessed at.
  for (const limit of ['Baselines', 'Anomaly detection', 'SLOs', 'Long-term reports']) expect(body).toContain(limit);

  // And the switch itself is unticked: enabling is an action, never a default.
  await expect(page.locator('#enabled')).not.toBeChecked();
});

test('§33.12 — the estimate is a cost per billing unit, and is called an estimate', async ({ page }) => {
  await login(page);
  await page.goto('/en/settings/history');
  const body = await page.locator('body').innerText();

  expect(body).toContain('Estimated monthly cost');
  expect(body).toMatch(/Metrics: [\d,]+ requested a month/);
  // Never a bare number presented as a bill.
  expect(body).toContain('It is not a bill');
  expect(body).toMatch(/\d+ cycles a month/);
});

test('the interval and retention offer the documented choices', async ({ page }) => {
  await login(page);
  await page.goto('/en/settings/history');

  const intervals = await page.locator('#intervalMinutes option').evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value),
  );
  expect(intervals).toEqual(['1', '5', '10', '15', '30', '60']);

  const retentions = await page.locator('#retentionDays option').evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value),
  );
  expect(retentions).toEqual(['30', '90', '180', '365']);
});

test('enabling and disabling round-trips, and the page reflects the state it saved', async ({ page }) => {
  await login(page);
  await page.goto('/en/settings/history');

  await page.locator('#enabled').check();
  await page.locator('#intervalMinutes').selectOption('15');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.reload();
  await expect(page.locator('#enabled')).toBeChecked();
  await expect(page.locator('#intervalMinutes')).toHaveValue('15');
  await expect(page.locator('[data-slot="card-title"]', { hasText: 'Collecting history' })).toBeVisible();

  // Turned back off, because leaving an installation collecting is spending someone's money.
  await page.locator('#enabled').uncheck();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.reload();
  await expect(page.locator('#enabled')).not.toBeChecked();
  await expect(page.locator('body')).toContainText('What stays limited without history');
});
