import { expect, test } from '@playwright/test';
import { ensureMonitoringConnection, login, monitoringUrl } from './helpers';

/**
 * Service level objectives (§19).
 *
 * The acceptance criterion is SLO-1: an operator can write down *their* target, rather than reading a
 * figure measured against a number OpsWatch chose. The second is §2.6 — a target with no history behind
 * it shows no figure, instead of one that looks met.
 */

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

const url = () => monitoringUrl(connectionId, 'load-balancers', 'objectives');

test('the Load balancers menu links to Objectives', async ({ page }) => {
  await page.goto(monitoringUrl(connectionId, 'load-balancers', 'list'));
  await expect(page.getByRole('navigation', { name: 'Load balancers pages' }).getByRole('link', { name: 'Objectives' })).toBeVisible();
});

test('§19 — the page says where its figures come from, and what is missing without history', async ({ page }) => {
  await page.goto(url());
  const main = await page.locator('main').innerText();
  expect(main).toContain('Opening this page reads nothing from AWS');
  // Historical collection is off on a fresh instance, and the page says so rather than showing blanks.
  expect(main).toContain('Historical collection is off');
  expect(main).toContain('No objectives are defined');
  expect(main).toContain('99.9%');
});

test('THE RULING: an objective can be defined, and shows a target with no figure it cannot support', async ({ page }) => {
  await page.goto(url());
  await page.getByLabel('Name').fill('Checkout availability');
  await page.getByLabel('Load balancer', { exact: true }).fill('app/e2e-alb/1a2b');
  await page.getByLabel('Objective (%)').fill('99.5');
  await page.getByRole('button', { name: 'Save objective' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.reload();
  const main = page.locator('main');
  await expect(main).toContainText('Checkout availability');
  // The target is the operator's decision and is shown; the measurement is not invented to match it.
  await expect(main).toContainText('Target 99.500%');
  await expect(main).toContainText('Not measured');
  await expect(main).toContainText('Unknown');

  await page.getByRole('button', { name: 'Remove' }).first().click();
  await expect(page.locator('main')).toContainText('No objectives are defined');
});

test('an objective outside 0–100 is refused rather than stored', async ({ page }) => {
  await page.goto(url());
  await page.getByLabel('Name').fill('Impossible');
  await page.getByLabel('Load balancer', { exact: true }).fill('app/e2e-alb/1a2b');
  await page.getByLabel('Objective (%)').fill('150');
  await page.getByRole('button', { name: 'Save objective' }).click();
  await expect(page.getByText('An objective is a percentage above 0 and at most 100.')).toBeVisible();
  await expect(page.locator('main')).toContainText('No objectives are defined');
});

test('a latency objective without a threshold is refused, because it could never be measured', async ({ page }) => {
  await page.goto(url());
  await page.getByLabel('Name').fill('Checkout latency');
  await page.getByLabel('Load balancer', { exact: true }).fill('app/e2e-alb/1a2b');
  await page.getByLabel('Measured on').selectOption('latency');
  await page.getByRole('button', { name: 'Save objective' }).click();
  await expect(page.getByText('A latency objective needs a threshold in milliseconds, above zero.')).toBeVisible();
  await expect(page.locator('main')).toContainText('No objectives are defined');
});

test('§21 — changing an objective is recorded in the audit log', async ({ page }) => {
  await page.goto(url());
  await page.getByLabel('Name').fill('Audited objective');
  await page.getByLabel('Load balancer', { exact: true }).fill('app/e2e-alb/1a2b');
  await page.getByRole('button', { name: 'Save objective' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.goto('/en/settings/audit');
  await expect(page.locator('main')).toContainText('Objective changed');

  // Left as it was found, so the next spec does not inherit an objective it did not define.
  await page.goto(url());
  await page.getByRole('button', { name: 'Remove' }).first().click();
  await expect(page.locator('main')).toContainText('No objectives are defined');
});
